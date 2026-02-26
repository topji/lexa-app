import type { Metadata } from 'next'
import { Orbitron, Rajdhani } from 'next/font/google'
import './globals.css'
import { Providers } from './providers'
import SideNav from '@/components/SideNav'

const orbitron = Orbitron({
  subsets: ['latin'],
  variable: '--font-orbitron',
  display: 'swap',
})
const rajdhani = Rajdhani({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-rajdhani',
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'Lexa - Polymarket AI Assistant',
  description: 'Ask AI about Polymarket markets',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" className={`${orbitron.variable} ${rajdhani.variable} bg-void`}>
      <body className="font-sans bg-void text-gray-100 antialiased">
        <Providers>
          <SideNav />
          <main className="min-h-screen pt-14 pl-0 lg:pt-0 lg:pl-56">{children}</main>
        </Providers>
      </body>
    </html>
  )
}

