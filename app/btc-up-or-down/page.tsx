'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

export default function BtcUpOrDownRedirect() {
  const router = useRouter()
  useEffect(() => {
    router.replace('/crypto/btc-updown-15m-1771286400')
  }, [router])
  return (
    <div className="min-h-screen bg-[#0a0a0f] flex items-center justify-center text-gray-500 text-sm">
      Redirecting to Crypto…
    </div>
  )
}
