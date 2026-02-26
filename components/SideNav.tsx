'use client'

import { useState } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { usePathname } from 'next/navigation'
import { ConnectWallet } from '@/components/ConnectWallet'
import { GaslessWalletDeploy } from '@/components/GaslessWalletDeploy'

const navItems = [
  { href: '/', label: 'Chat' },
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/crypto', label: 'Crypto' },
]

export default function SideNav() {
  const pathname = usePathname()
  const [mobileOpen, setMobileOpen] = useState(false)

  const navContent = (
    <>
      <div className="p-4 sm:p-5 border-b border-lexa-border flex items-center justify-between sm:block">
        <Link
          href="/"
          onClick={() => setMobileOpen(false)}
          className="flex items-center gap-3 text-lg font-display font-bold tracking-tight text-white hover:text-lexa-accent transition-colors"
        >
          <Image src="/lexa-logo.PNG" alt="Lexa" width={36} height={36} className="rounded-lg shrink-0" />
          <span>Lexa</span>
        </Link>
        <button
          type="button"
          onClick={() => setMobileOpen(false)}
          className="lg:hidden p-2 -mr-2 text-gray-400 hover:text-white rounded-lg"
          aria-label="Close menu"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
      <p className="font-sans text-xs text-gray-500 mt-0.5 px-4 sm:px-5 sm:ml-9 pb-4 sm:pb-0 border-b border-lexa-border lg:border-b-0">Polymarket assistant</p>
      <nav className="flex flex-col gap-0.5 p-3">
        {navItems.map(({ href, label }) => {
          const isActive = pathname === href || (href !== '/' && pathname.startsWith(href))
          return (
            <Link
              key={href}
              href={href}
              onClick={() => setMobileOpen(false)}
              className={`rounded-xl px-3 py-2.5 text-sm font-display font-semibold uppercase tracking-wide transition-colors ${
                isActive
                  ? 'bg-lexa-gradient text-white shadow-glow-lexa'
                  : 'text-gray-400 hover:bg-lexa-accent/10 hover:text-white'
              }`}
            >
              {label}
            </Link>
          )
        })}
      </nav>
      <div className="mt-auto p-3 border-t border-lexa-border">
        <ConnectWallet />
        <GaslessWalletDeploy />
      </div>
    </>
  )

  return (
    <>
      {/* Mobile menu button */}
      <button
        type="button"
        onClick={() => setMobileOpen(true)}
        className="lg:hidden fixed top-4 left-4 z-30 p-2 rounded-xl bg-lexa-glass border border-lexa-border text-white hover:border-lexa-accent transition-colors"
        aria-label="Open menu"
      >
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
        </svg>
      </button>

      {/* Overlay when mobile menu open */}
      {mobileOpen && (
        <div
          className="lg:hidden fixed inset-0 z-40 bg-black/60 backdrop-blur-sm"
          onClick={() => setMobileOpen(false)}
          aria-hidden
        />
      )}

      {/* Sidebar: drawer on mobile, fixed on desktop */}
      <aside
        className={`fixed left-0 top-0 z-50 flex h-full w-56 flex-col border-r border-lexa-border bg-void backdrop-blur-sm transition-transform duration-200 ease-out lg:translate-x-0 lg:z-20
          ${mobileOpen ? 'translate-x-0' : '-translate-x-full'}`}
      >
        {navContent}
      </aside>
    </>
  )
}
