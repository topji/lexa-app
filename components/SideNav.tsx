'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { ConnectWallet } from '@/components/ConnectWallet'
import { GaslessWalletDeploy } from '@/components/GaslessWalletDeploy'

const navItems = [
  { href: '/', label: 'Chat' },
  { href: '/markets', label: 'Markets' },
  { href: '/crypto', label: 'Crypto' },
]

export default function SideNav() {
  const pathname = usePathname()

  return (
    <aside className="fixed left-0 top-0 z-20 flex h-full w-56 flex-col border-r border-[#1e293b] bg-[#0f172a]/95 backdrop-blur-sm">
      <div className="p-5 border-b border-[#1e293b]">
        <Link href="/" className="text-lg font-semibold tracking-tight text-white hover:text-blue-400 transition-colors">
          Lexa
        </Link>
        <p className="text-xs text-gray-500 mt-0.5">Polymarket assistant</p>
      </div>
      <nav className="flex flex-col gap-0.5 p-3">
        {navItems.map(({ href, label }) => {
          const isActive = pathname === href || (href !== '/' && pathname.startsWith(href))
          return (
            <Link
              key={href}
              href={href}
              className={`rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                isActive
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'text-gray-400 hover:bg-[#1e293b] hover:text-white'
              }`}
            >
              {label}
            </Link>
          )
        })}
      </nav>
      <div className="mt-auto p-3 border-t border-[#1e293b]">
        <ConnectWallet />
        <GaslessWalletDeploy />
      </div>
    </aside>
  )
}
