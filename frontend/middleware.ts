import { createServerClient, type CookieOptions } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { buildCsp, SECURITY_HEADERS } from '@/lib/security/csp'

export async function middleware(request: NextRequest) {
  // --- Content Security Policy (mitigasi XSS pencuri API key) --------------
  // Nonce HARUS unik per request; kalau dipakai ulang, penyerang bisa menebak
  // dan menyematkan skrip yang lolos CSP.
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64')
  const csp = buildCsp(nonce, process.env.NODE_ENV === 'development')

  // Ditulis ke header REQUEST supaya Next.js membacanya dan menempelkan nonce
  // yang sama ke <script> internalnya (bootstrap/hydration). Tanpa langkah ini
  // skrip Next sendiri akan diblokir CSP dan halaman jadi kosong.
  const requestHeaders = new Headers(request.headers)
  requestHeaders.set('x-nonce', nonce)
  requestHeaders.set('Content-Security-Policy', csp)

  let response = NextResponse.next({
    request: {
      headers: requestHeaders,
    },
  })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return request.cookies.get(name)?.value
        },
        set(name: string, value: string, options: CookieOptions) {
          request.cookies.set({ name, value, ...options })
          response = NextResponse.next({
            request: { headers: requestHeaders },
          })
          response.cookies.set({ name, value, ...options })
        },
        remove(name: string, options: CookieOptions) {
          request.cookies.set({ name, value: '', ...options })
          response = NextResponse.next({
            request: { headers: requestHeaders },
          })
          response.cookies.set({ name, value: '', ...options })
        },
      },
    }
  )

  const { data: { user } } = await supabase.auth.getUser()

  const path = request.nextUrl.pathname
  const isAuthRoute = path.startsWith('/login')
  const isApiRoute = path.startsWith('/api') || path.startsWith('/auth')
  const isPublicRoute = path.startsWith('/market-intelligence')

  const withSecurity = (res: NextResponse) => {
    res.headers.set('Content-Security-Policy', csp)
    for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.headers.set(k, v)
    return res
  }

  if (!user && !isAuthRoute && !isApiRoute && !isPublicRoute) {
    return withSecurity(NextResponse.redirect(new URL('/login', request.url)))
  }

  if (user && isAuthRoute) {
    return withSecurity(NextResponse.redirect(new URL('/', request.url)))
  }

  return withSecurity(response)
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}