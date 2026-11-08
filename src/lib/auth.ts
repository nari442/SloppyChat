const usernameAlphabet = 'abcdefghijklmnopqrstuvwxyz234567'
const usernamePattern = /^[a-z2-7]{12}$/
const authDomain = 'auth.sloppy.chat'

export function generateUsername(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(12))
  return Array.from(bytes, (byte) => usernameAlphabet[byte & 31]).join('')
}

export function normalizeUsername(username: string): string {
  return username.trim().toLowerCase()
}

export function isValidUsername(username: string): boolean {
  return usernamePattern.test(normalizeUsername(username))
}

export function authEmailForUsername(username: string): string {
  const normalized = normalizeUsername(username)
  if (!isValidUsername(normalized)) {
    throw new Error('Enter a valid Sloppy username.')
  }
  return `${normalized}@${authDomain}`
}

export function getPasswordRequirements(password: string) {
  return {
    minimumLength: [...password].length >= 12,
    lowercase: /[a-z]/.test(password),
    uppercase: /[A-Z]/.test(password),
    number: /[0-9]/.test(password),
    specialCharacter: /[^A-Za-z0-9\s]/.test(password),
    maximumBytes: new TextEncoder().encode(password).byteLength <= 72
  }
}

export function validatePassword(password: string): string | null {
  const requirements = getPasswordRequirements(password)
  if (!requirements.minimumLength) {
    return 'Use a password with at least 12 characters.'
  }
  if (!requirements.uppercase) {
    return 'Add at least one uppercase letter.'
  }
  if (!requirements.lowercase) {
    return 'Add at least one lowercase letter.'
  }
  if (!requirements.number) {
    return 'Add at least one number.'
  }
  if (!requirements.specialCharacter) {
    return 'Add at least one special character.'
  }
  if (!requirements.maximumBytes) {
    return 'Use a password no longer than 72 bytes.'
  }
  return null
}

export function registrationErrorMessage(message: string): string {
  if (/email.*(invalid|rate limit)|rate limit.*email/i.test(message)) {
    return 'Supabase is validating or sending confirmation for Sloppy’s generated sign-in address. Turn off Confirm email in Supabase Authentication settings, then retry. If you have just tried registering, wait for the email rate limit to reset.'
  }
  return message
}
