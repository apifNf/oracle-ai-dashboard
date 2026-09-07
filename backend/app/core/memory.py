"""
backend/app/core/memory.py

Utilitas manajemen memori untuk worker real-time (anti-OOM di Render).

GcPacer: memaksa gc.collect() secara periodik di dalam loop worker — pandas /
numpy / feedparser / websockets meninggalkan banyak objek sementara yang, di
heap kecil (512 MB Render), menumpuk lebih cepat daripada GC generasi Python
menyapunya. Pemanggilan eksplisit menjaga RSS proses tetap datar.
"""

from __future__ import annotations

import gc
import logging
import time

logger = logging.getLogger(__name__)

__all__ = ["GcPacer", "freeze_after_startup"]


class GcPacer:
    """
    tick() dipanggil di setiap iterasi loop worker. gc.collect() dijalankan
    ketika SALAH SATU terpenuhi:
      - sudah lewat `every_seconds` sejak collect terakhir, ATAU
      - sudah `every_calls` kali tick sejak collect terakhir (0 = nonaktif).
    """

    __slots__ = ("_every_s", "_every_c", "_tag", "_last", "_calls")

    def __init__(
        self,
        *,
        every_seconds: float = 120.0,
        every_calls: int = 0,
        tag: str = "worker",
    ) -> None:
        self._every_s = float(every_seconds)
        self._every_c = int(every_calls)
        self._tag = tag
        self._last = time.monotonic()
        self._calls = 0

    def tick(self) -> bool:
        self._calls += 1
        now = time.monotonic()
        due = (self._every_s > 0 and now - self._last >= self._every_s) or (
            self._every_c > 0 and self._calls >= self._every_c
        )
        if not due:
            return False
        collected = gc.collect()
        self._last = now
        self._calls = 0
        if collected:
            logger.debug("gc[%s]: %d objek dikumpulkan.", self._tag, collected)
        return True

    def collect_now(self) -> None:
        gc.collect()
        self._last = time.monotonic()
        self._calls = 0


def freeze_after_startup() -> None:
    """
    Pindahkan semua objek yang sudah hidup saat startup ke luar cakupan GC
    (gc.freeze). Setelah worker & FastAPI ter-mount, objek-objek ini tidak akan
    jadi sampah — mengeluarkannya membuat setiap gc.collect() berikutnya lebih
    murah dan mengurangi fragmentasi.
    """
    try:
        gc.collect()
        gc.freeze()
        logger.info("gc.freeze() dipanggil — objek startup dikecualikan dari GC.")
    except Exception:  # pragma: no cover
        logger.debug("gc.freeze() gagal (tidak fatal).", exc_info=True)
