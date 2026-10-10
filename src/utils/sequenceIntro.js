const INTRO_KEY = 'joker-intro-seen-v1'
let seenThisSession = false

export function hasSeenSequenceIntro() {
  try {
    return seenThisSession || localStorage.getItem(INTRO_KEY) === '1'
  } catch {
    return seenThisSession
  }
}

export function rememberSequenceIntro() {
  seenThisSession = true
  try {
    localStorage.setItem(INTRO_KEY, '1')
  } catch {
    // Private browsing can deny storage; navigation still skips repeat intros.
  }
}
