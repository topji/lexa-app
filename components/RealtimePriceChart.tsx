'use client'

import { useEffect, useRef } from 'react'

export interface ChartPoint {
  time: number
  value: number
}

interface RealtimePriceChartProps {
  data: ChartPoint[]
  height?: number
  className?: string
  lineColor?: string
  /** Reference price (e.g. price to beat) shown as a horizontal line */
  referencePrice?: number
}

export default function RealtimePriceChart({
  data,
  height = 320,
  className = '',
  lineColor = '#22c55e',
  referencePrice,
}: RealtimePriceChartProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<{
    chart: { remove: () => void; timeScale: () => { scrollToRealTime: () => void; fitContent: () => void } };
    series: { update: (p: { time: number; value: number }) => void; setData: (d: { time: number; value: number }[]) => void };
    referenceSeries: { setData: (d: { time: number; value: number }[]) => void } | null;
  } | null>(null)
  const lastTimeRef = useRef<number | null>(null)

  useEffect(() => {
    if (typeof window === 'undefined' || !containerRef.current) return
    const { createChart } = require('lightweight-charts')
    const container = containerRef.current
    const chart = createChart(container, {
      autoSize: true,
      layout: {
        background: { type: 'solid', color: '#0f172a' },
        textColor: '#94a3b8',
        fontFamily: 'ui-monospace, monospace',
        fontSize: 11,
      },
      grid: {
        vertLines: { color: '#1e293b' },
        horzLines: { color: '#1e293b' },
      },
      rightPriceScale: {
        borderColor: '#334155',
        scaleMargins: { top: 0.1, bottom: 0.1 },
      },
      timeScale: {
        borderColor: '#334155',
        timeVisible: true,
        secondsVisible: false,
      },
      crosshair: { mode: 1 },
    })

    const lineSeries = chart.addLineSeries({
      color: lineColor,
      lineWidth: 2,
      priceFormat: { type: 'price', precision: 2, minMove: 0.01 },
    })

    const referenceSeries = chart.addLineSeries({
      color: '#64748b',
      lineWidth: 1,
      lineStyle: 2,
      priceFormat: { type: 'price', precision: 2, minMove: 0.01 },
      lastValueVisible: false,
      priceLineVisible: false,
    })

    chartRef.current = { chart, series: lineSeries, referenceSeries }

    return () => {
      chart.remove()
      chartRef.current = null
    }
  }, [lineColor])

  useEffect(() => {
    const ref = chartRef.current
    if (!ref?.referenceSeries || referencePrice == null || data.length < 2) return
    const t0 = data[0].time
    const t1 = data[data.length - 1].time
    ref.referenceSeries.setData([
      { time: t0, value: referencePrice },
      { time: t1, value: referencePrice },
    ])
  }, [data, referencePrice])

  useEffect(() => {
    const ref = chartRef.current
    if (!ref) return
    if (data.length === 0) return
    const formatted = data.map((d) => ({ time: d.time, value: d.value }))
    if (lastTimeRef.current == null) {
      ref.series.setData(formatted)
      ref.chart.timeScale().fitContent()
    } else {
      const last = data[data.length - 1]
      ref.series.update({ time: last.time, value: last.value })
    }
    lastTimeRef.current = data[data.length - 1]?.time ?? null
    ref.chart.timeScale().scrollToRealTime()
  }, [data])

  return (
    <div className={`relative ${className}`} style={{ minHeight: height }}>
      <div
        ref={containerRef}
        className="w-full"
        style={{ width: '100%', height }}
      />
      {data.length === 0 && (
        <div
          className="absolute inset-0 flex items-center justify-center text-gray-500 text-sm bg-[#0f172a]/80"
          style={{ top: 0, left: 0, right: 0, bottom: 0 }}
        >
          Waiting for price data…
        </div>
      )}
    </div>
  )
}
