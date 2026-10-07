// A camera QR reader: BarcodeDetector where the browser has one, jsQR
// elsewhere. Calls onText once with the first code it reads, then stops.

import { useCallback, useEffect, useRef, useState } from 'react'
import jsQR from 'jsqr'
import { useLanguage } from '../lib/i18n'

export default function QrScanner({ onText, onError }: { onText: (text: string) => void; onError: (message: string) => void }) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const loopRef = useRef<number | null>(null)
  const [on, setOn] = useState(false)
  const { t } = useLanguage()

  const stop = useCallback(() => {
    if (loopRef.current !== null) cancelAnimationFrame(loopRef.current)
    loopRef.current = null
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
    setOn(false)
  }, [])

  useEffect(() => stop, [stop])

  const start = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false })
      streamRef.current = stream
      const video = videoRef.current!
      video.srcObject = stream
      await video.play()
      setOn(true)
      const Detector = (window as unknown as { BarcodeDetector?: new (o: object) => { detect(s: CanvasImageSource): Promise<{ rawValue: string }[]> } }).BarcodeDetector
      const detector = Detector ? new Detector({ formats: ['qr_code'] }) : null
      let last = 0
      const tick = async (time: number) => {
        if (!streamRef.current) return
        if (time - last > 180 && video.readyState >= 2) {
          last = time
          let text: string | null = null
          try {
            if (detector) text = (await detector.detect(video))[0]?.rawValue ?? null
            else if (canvasRef.current) {
              const c = canvasRef.current
              c.width = video.videoWidth
              c.height = video.videoHeight
              const ctx = c.getContext('2d', { willReadFrequently: true })
              if (ctx) {
                ctx.drawImage(video, 0, 0)
                const img = ctx.getImageData(0, 0, c.width, c.height)
                text = jsQR(img.data, img.width, img.height, { inversionAttempts: 'attemptBoth' })?.data ?? null
              }
            }
          } catch {
            /* one bad frame; keep going */
          }
          if (text) {
            stop()
            return onText(text)
          }
        }
        loopRef.current = requestAnimationFrame(tick)
      }
      loopRef.current = requestAnimationFrame(tick)
    } catch {
      stop()
      onError(t('contacts.camera_error'))
    }
  }

  return (
    <div className="space-y-2">
      <video ref={videoRef} playsInline muted className={`w-full max-w-xs rounded-lg bg-black ${on ? '' : 'hidden'}`} />
      <canvas ref={canvasRef} className="hidden" />
      {!on ? (
        <button type="button" onClick={start} className="px-3 py-1.5 rounded-lg border border-stone-300 text-xs font-semibold">{t('contacts.scan_camera')}</button>
      ) : (
        <button type="button" onClick={stop} className="px-3 py-1.5 rounded-lg border border-stone-300 text-xs font-semibold">{t('contacts.stop')}</button>
      )}
    </div>
  )
}
