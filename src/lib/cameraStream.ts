// One camera stream shared by every scan in this tab. Phones ask for camera
// permission on each getUserMedia call, so scanning twice meant two prompts.
// Between scans the tracks are only switched off (no picture, no prompt on the
// next scan); the camera is fully released when the app goes to the
// background, or after a few idle minutes.

const IDLE_MS = 3 * 60 * 1000

let stream: MediaStream | null = null
let pending: Promise<MediaStream> | null = null
let idleTimer: number | null = null

function release() {
  if (idleTimer !== null) window.clearTimeout(idleTimer)
  idleTimer = null
  stream?.getTracks().forEach((track) => track.stop())
  stream = null
}

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') release()
  })
  window.addEventListener('pagehide', release)
}

export async function acquireCamera(): Promise<MediaStream> {
  if (idleTimer !== null) window.clearTimeout(idleTimer)
  idleTimer = null
  if (stream && stream.getVideoTracks().some((track) => track.readyState === 'live')) {
    stream.getTracks().forEach((track) => (track.enabled = true))
    return stream
  }
  stream = null
  pending ??= navigator.mediaDevices
    .getUserMedia({ video: { facingMode: 'environment' }, audio: false })
    .finally(() => {
      pending = null
    })
  stream = await pending
  return stream
}

/** Done scanning for now: blank the tracks, and let go of them if unused for a while. */
export function parkCamera() {
  stream?.getTracks().forEach((track) => (track.enabled = false))
  if (idleTimer !== null) window.clearTimeout(idleTimer)
  idleTimer = window.setTimeout(release, IDLE_MS)
}
