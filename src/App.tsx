import { createContext, useCallback, useContext, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import {
  ArrowLeft,
  Archive,
  Ban,
  Check,
  ChevronDown,
  Copy,
  Eraser,
  Github,
  ImagePlus,
  LoaderCircle,
  LockKeyhole,
  LogOut,
  MessageCircle,
  MoreHorizontal,
  Plus,
  Pencil,
  Search,
  Send,
  Settings,
  ShieldAlert,
  ShieldCheck,
  Smartphone,
  Trash2,
  UserPlus,
  Users,
  X
} from 'lucide-react'
import type { Session, SupabaseClient } from '@supabase/supabase-js'
import {
  createConversation,
  decryptRealtimeMessage,
  loadConversations,
  loadMessages,
  memberDisplayName,
  memberUsername,
  sendMessage,
  type ChatMessage,
  type Conversation,
  type StoredMessage
} from './lib/chat-service'
import {
  decryptIncomingMessageRequest,
  loadIncomingMessageRequests,
  respondToMessageRequest,
  sendMessageRequest,
  type IncomingMessageRequest
} from './lib/chat-service'
import { conversationMemberNames } from './lib/conversation-label'
import { ConversationLabel } from './components/ConversationLabel'
import { Handle } from './components/Handle'
import { SettingsDialog } from './components/SettingsDialog'
import { Button } from './components/ui/button'
import { Card } from './components/ui/card'
import { Dialog, DialogContent } from './components/ui/dialog'
import { Input } from './components/ui/input'
import { Textarea } from './components/ui/textarea'
import { authEmailForUsername, generateUsername, getPasswordRequirements, isValidUsername, registrationErrorMessage, validatePassword } from './lib/auth'
import { appRouteFromPath, canonicalAppPath, pathForAppRoute, type AppRoute } from './lib/app-routes'
import { identityFingerprint } from './lib/crypto'
import {
  addGroupMembers,
  blockUser,
  clearConversation,
  deleteDirectConversationForEveryone,
  hideConversation,
  loadConversationPreferences,
  type ConversationPreference
} from './lib/conversation-service'
import { approveDevice, activateOrRequestDevice, loadConversationDevices, revokeDevice, type DeviceState, type StoredDevice } from './lib/device-service'
import { saveDeviceVault, type DeviceVault } from './lib/device-vault'
import {
  decryptImageAttachment,
  parseImageAttachment,
  removeUploadedImage,
  uploadEncryptedImage,
  validateImageFile,
  type ImageAttachment
} from './lib/image-attachment'
import { createSupabaseClient } from './lib/supabase'
import { accentForeground, darkAccentColor, normalizeAccentColor, type AccentColor } from './lib/appearance'
import { brandIconForAccent } from './lib/brand-icons'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabasePublishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY
const DialogCloseContext = createContext<((afterClose?: () => void) => void) | null>(null)

function useDialogClose(onClose: () => void) {
  const requestClose = useContext(DialogCloseContext)
  return requestClose ?? ((afterClose?: () => void) => {
    onClose()
    afterClose?.()
  })
}

type AuthMode = 'login' | 'register'
type ThemePreference = 'system' | 'light' | 'dark'
type ContactOption = { userId: string; username: string; displayName: string }
type PeerIdentity = {
  userId: string
  username: string
  fingerprint: string
  status: 'verified' | 'unverified' | 'changed' | 'missing' | 'conflict'
}

function messageFromError(reason: unknown): string {
  return reason instanceof Error ? reason.message : 'Something went wrong. Please try again.'
}

function loadConversationNicknames(userId: string): { values: Record<string, string>; error: string } {
  try {
    const saved = window.localStorage.getItem(`sloppy-conversation-nicknames:${userId}`)
    if (!saved) {
      return { values: {}, error: '' }
    }
    const parsed: unknown = JSON.parse(saved)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('Stored conversation nicknames have an invalid format.')
    }
    const validEntries = Object.entries(parsed).filter((entry): entry is [string, string] => (
      typeof entry[1] === 'string'
    ))
    return { values: Object.fromEntries(validEntries), error: '' }
  } catch (reason) {
    return { values: {}, error: `Could not load local conversation nicknames: ${messageFromError(reason)}` }
  }
}

function workspaceErrorMessage(reason: unknown): string {
  const message = messageFromError(reason)
  if (/ensure_my_profile.*(schema cache|function|does not exist)|(?:schema cache|function|does not exist).*ensure_my_profile/i.test(message)) {
    return 'This Supabase project is missing the profile repair function. Run database/007_profile_self_repair.sql in the Supabase SQL Editor, then refresh the page.'
  }
  if (/conversation_preferences.*(schema cache|does not exist)|(?:schema cache|does not exist).*conversation_preferences/i.test(message)) {
    return 'The Sloppy settings migration is missing. In the Supabase SQL Editor, run supabase/migrations/202611080003_settings_conversation_media.sql, then run NOTIFY pgrst, \'reload schema\'; and refresh this page. This migration preserves existing accounts and messages.'
  }
  if (/public\.profiles.*schema cache|schema cache.*public\.profiles|relation.*profiles.*does not exist/i.test(message)) {
    return 'The public.profiles table is not available to Sloppy. Open supabase/migrations/202611080001_initial_schema.sql in your project, copy its entire contents, and paste that SQL into the Supabase SQL Editor before clicking Run. Do not enter the file path as SQL. If the migration was already applied, run NOTIFY pgrst, \'reload schema\'; instead. Then sign out and sign in again.'
  }
  return message
}

const supabaseConfiguration = (() => {
  if (!supabaseUrl || !supabasePublishableKey) {
    return { client: null, error: 'Supabase URL and public publishable key are missing from the environment.' }
  }
  try {
    return { client: createSupabaseClient(supabaseUrl, supabasePublishableKey), error: '' }
  } catch (reason) {
    return { client: null, error: messageFromError(reason) }
  }
})()

function App() {
  const [route, setRoute] = useState<AppRoute>(() => appRouteFromPath(window.location.pathname))
  const [accentColor, setAccentColor] = useState(() => normalizeAccentColor(window.localStorage.getItem('sloppy-accent-color')))
  const [theme, setTheme] = useState<ThemePreference>(() => {
    const saved = window.localStorage.getItem('sloppy-theme-preference')
    return saved === 'light' || saved === 'dark' ? saved : 'system'
  })
  const configuration = supabaseConfiguration
  const client = configuration.client
  const [session, setSession] = useState<Session | null>(null)
  const [sessionLoading, setSessionLoading] = useState(true)
  const [sessionError, setSessionError] = useState('')

  const navigateToRoute = useCallback((nextRoute: AppRoute, replace = false) => {
    const path = pathForAppRoute(nextRoute)
    if (window.location.pathname !== path) {
      window.history[replace ? 'replaceState' : 'pushState']({}, '', path)
    }
    setRoute(nextRoute)
  }, [])

  useEffect(() => {
    const canonicalPath = canonicalAppPath(window.location.pathname)
    if (window.location.pathname !== canonicalPath) {
      window.history.replaceState({}, '', canonicalPath)
      setRoute(appRouteFromPath(canonicalPath))
    }
    const handlePopState = () => setRoute(appRouteFromPath(window.location.pathname))
    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [])

  useEffect(() => {
    const colorScheme = window.matchMedia('(prefers-color-scheme: dark)')
    const applyTheme = () => {
      document.documentElement.dataset.theme = theme === 'system'
        ? colorScheme.matches ? 'dark' : 'light'
        : theme
    }
    applyTheme()
    if (theme === 'system') {
      window.localStorage.removeItem('sloppy-theme-preference')
      colorScheme.addEventListener('change', applyTheme)
      return () => colorScheme.removeEventListener('change', applyTheme)
    }
    window.localStorage.setItem('sloppy-theme-preference', theme)
  }, [theme])

  useEffect(() => {
    const root = document.documentElement
    root.style.setProperty('--brand-color', accentColor)
    root.style.setProperty('--brand-foreground', accentForeground(accentColor))
    const darkColor = darkAccentColor(accentColor)
    root.style.setProperty('--brand-dark-color', darkColor)
    root.style.setProperty('--brand-dark-foreground', accentForeground(darkColor))
    const icon = brandIconForAccent(accentColor)
    root.style.setProperty('--brand-icon', `url("${icon}")`)
    window.localStorage.setItem('sloppy-accent-color', accentColor)
    const favicon = document.querySelector<HTMLLinkElement>('link[rel="icon"]')
    if (favicon) favicon.href = icon
    document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]').forEach((meta) => {
      meta.content = accentColor
    })
  }, [accentColor])

  useEffect(() => {
    if (!client) {
      return
    }
    let active = true
    client.auth.getSession().then(({ data, error }) => {
      if (!active) {
        return
      }
      if (error) {
        setSessionError(`Could not restore your session: ${error.message}`)
        setSessionLoading(false)
        return
      }
      setSession(data.session)
      setSessionLoading(false)
    }).catch((reason: unknown) => {
      if (active) {
        setSessionError(`Could not restore your session: ${messageFromError(reason)}`)
        setSessionLoading(false)
      }
    })
    const { data: authListener } = client.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession)
      setSessionLoading(false)
    })
    return () => {
      active = false
      authListener.subscription.unsubscribe()
    }
  }, [client])

  let screen: ReactNode
  if (!client) {
    screen = <SetupNotice error={configuration.error} />
  } else if (sessionLoading) {
    screen = <LoadingScreen label="Connecting to Sloppy" />
  } else if (sessionError) {
    screen = <ProblemScreen error={sessionError} onSignOut={() => setSessionError('')} />
  } else if (!session) {
    screen = <AuthScreen client={client} />
  } else {
    screen = <Workspace client={client} session={session} theme={theme} onThemeChange={setTheme} accentColor={accentColor} onAccentColorChange={setAccentColor} route={route} onNavigate={navigateToRoute} />
  }

  return <>{screen}</>
}

function SetupNotice({ error }: { error: string }) {
  return (
    <main className="grid min-h-screen place-items-center bg-background px-5 py-10">
      <section className="w-full max-w-xl rounded-xl bg-card p-8 shadow-lift sm:p-10">
        <BrandMark />
        <h1 className="mt-8 text-3xl font-semibold tracking-tight text-foreground">Connect your Supabase project</h1>
        <p className="mt-3 leading-7 text-muted-foreground">
          Add the project URL and public publishable key to a local <code className="rounded-lg bg-secondary px-2 py-1 text-sm">.env</code> file.
          Apply the SQL migration and disable email confirmations for password-only registration.
        </p>
        <pre className="mt-6 overflow-x-auto rounded-lg bg-[#17252b] p-5 text-sm leading-7 text-[#b2f1d3]"><code>VITE_SUPABASE_URL=https://your-project.supabase.co{'\n'}VITE_SUPABASE_PUBLISHABLE_KEY=your-public-publishable-key</code></pre>
        <p className="mt-5 text-sm leading-6 text-muted-foreground">
          Never use a Supabase service-role key in browser configuration. See the setup guide for auth and database steps.
        </p>
        <p className="mt-3 text-xs text-destructive" role="alert">{error}</p>
      </section>
    </main>
  )
}

function ErrorToast({ error, onDismiss }: { error: string; onDismiss: () => void }) {
  const [toast, setToast] = useState({ source: error, message: error, visible: Boolean(error) })
  if (error !== toast.source) {
    setToast({
      source: error,
      message: error || toast.message,
      visible: Boolean(error)
    })
  }

  if (!toast.message) return null

  return (
    <div
      className={`notice-toast fixed bottom-5 left-1/2 z-40 flex max-w-[calc(100%-2rem)] -translate-x-1/2 items-center gap-3 rounded-lg bg-destructive/10 px-4 py-3 text-sm text-destructive shadow-lift ${toast.visible ? '' : 'notice-toast-closed'}`}
      onTransitionEnd={(event) => {
        if (event.propertyName === 'opacity' && !toast.visible) {
          setToast({ source: '', message: '', visible: false })
        }
      }}
      role="alert"
    >
      <ShieldAlert className="shrink-0" size={17} />
      <span>{toast.message}</span>
      <Button aria-label="Dismiss error" className="shrink-0 rounded-full p-1 hover:bg-black/5" onClick={onDismiss} type="button"><X size={16} /></Button>
    </div>
  )
}

function BrandMark() {
  return (
    <div className="brand-mark flex items-center gap-3">
      <span aria-hidden="true" className="brand-mark-icon h-8 w-8 shrink-0" />
      <span className="text-xl font-semibold tracking-tight text-foreground">Sloppy</span>
    </div>
  )
}

function LoadingScreen({ label }: { label: string }) {
  return (
    <main className="grid min-h-screen place-items-center bg-background text-primary">
      <div className="flex items-center gap-3 rounded-full bg-card px-6 py-4 shadow-lift">
        <LoaderCircle className="animate-spin" size={20} />
        <span className="text-sm font-medium">{label}</span>
      </div>
    </main>
  )
}

function AuthScreen({ client }: { client: SupabaseClient }) {
  const [mode, setMode] = useState<AuthMode>('login')
  const [username, setUsername] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [generatedUsername, setGeneratedUsername] = useState('')
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setNotice('')
    setBusy(true)
    try {
      if (mode === 'register') {
        if (password !== confirmPassword) {
          throw new Error('Your passwords do not match.')
        }
        const passwordError = validatePassword(password)
        if (passwordError) {
          throw new Error(passwordError)
        }
        const newUsername = generateUsername()
        setGeneratedUsername(newUsername)
        const { data, error: signUpError } = await client.auth.signUp({
          email: authEmailForUsername(newUsername),
          password,
          options: { data: { username: newUsername, display_name: displayName.trim() || newUsername } }
        })
        if (signUpError) {
          throw new Error(registrationErrorMessage(signUpError.message))
        }
        setUsername('')
        setPassword('')
        setConfirmPassword('')
        setDisplayName('')
        if (!data.session) {
          setNotice('Account created. Disable email confirmations in Supabase Auth to continue without an email address.')
        } else {
          setNotice('Your private login handle is ready. Save it before leaving this page.')
        }
      } else {
        if (!isValidUsername(username)) {
          throw new Error('Enter your 12-character Sloppy username.')
        }
        const { error: signInError } = await client.auth.signInWithPassword({
          email: authEmailForUsername(username),
          password
        })
        if (signInError) {
          throw new Error(signInError.message)
        }
      }
    } catch (reason) {
      setError(messageFromError(reason))
    } finally {
      setBusy(false)
    }
  }

  const isRegister = mode === 'register'
  return (
    <main className="auth-background relative grid min-h-screen place-items-center overflow-hidden bg-background px-4 py-10">
      <div className="ambient-orb pointer-events-none absolute -left-24 top-12 h-72 w-72 rounded-full bg-accent/60 blur-3xl" />
      <div className="ambient-orb ambient-orb-delayed pointer-events-none absolute -bottom-28 -right-20 h-96 w-96 rounded-full bg-muted/50 blur-3xl" />
      <Card className="auth-panel relative w-full max-w-md gap-0 rounded-xl p-7 sm:p-10" key={mode}>
        <BrandMark />
        <div className="mt-10">
          <h1 className="text-[2rem] font-semibold tracking-tight text-foreground">
            {isRegister ? 'Create your space' : 'Welcome back'}
          </h1>
          <p className="mt-2 leading-6 text-muted-foreground">
            {isRegister
              ? 'Your account starts with a generated handle. Only your password is needed.'
              : 'Use your Sloppy handle and password to unlock your conversations.'}
          </p>
        </div>
        <form className="mt-7 space-y-4" onSubmit={submit}>
          {isRegister ? (
            <>
              <label className="block text-sm font-medium text-card-foreground">
                Display name <span className="font-normal text-muted-foreground">(optional)</span>
                <Input
                  autoComplete="name"
                  className="auth-input mt-2 w-full rounded-lg border border-border bg-background px-4 py-3.5 outline-none transition focus:border-primary focus:ring-4 focus:ring-primary/10"
                  maxLength={40}
                  onChange={(event) => setDisplayName(event.target.value)}
                  placeholder="Defaults to your generated handle"
                  value={displayName}
                />
              </label>
              <label className="block text-sm font-medium text-card-foreground">
                Password
                <Input
                  autoComplete="new-password"
                  className="auth-input mt-2 w-full rounded-lg border border-border bg-background px-4 py-3.5 outline-none transition focus:border-primary focus:ring-4 focus:ring-primary/10"
                  maxLength={72}
                  minLength={12}
                  onChange={(event) => setPassword(event.target.value)}
                  required
                  type="password"
                  value={password}
                />
              </label>
              <PasswordRequirements password={password} />
              <label className="block text-sm font-medium text-card-foreground">
                Confirm password
                <Input
                  autoComplete="new-password"
                  className="auth-input mt-2 w-full rounded-lg border border-border bg-background px-4 py-3.5 outline-none transition focus:border-primary focus:ring-4 focus:ring-primary/10"
                  maxLength={72}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  required
                  type="password"
                  value={confirmPassword}
                />
              </label>
            </>
          ) : (
            <>
              <label className="block text-sm font-medium text-card-foreground">
                Sloppy username
                <Input
                  autoCapitalize="none"
                  autoComplete="username"
                  className="auth-input mt-2 w-full rounded-lg border border-border bg-background px-4 py-3.5 outline-none transition focus:border-primary focus:ring-4 focus:ring-primary/10"
                  maxLength={12}
                  onChange={(event) => setUsername(event.target.value)}
                  pattern="[a-zA-Z2-7]{12}"
                  required
                  value={username}
                />
              </label>
              <label className="block text-sm font-medium text-card-foreground">
                Password
                <Input
                  autoComplete="current-password"
                  className="auth-input mt-2 w-full rounded-lg border border-border bg-background px-4 py-3.5 outline-none transition focus:border-primary focus:ring-4 focus:ring-primary/10"
                  maxLength={72}
                  onChange={(event) => setPassword(event.target.value)}
                  required
                  type="password"
                  value={password}
                />
              </label>
            </>
          )}
          {error && <p role="alert" className="rounded-lg bg-destructive/10 px-4 py-3 text-sm text-destructive">{error}</p>}
          {notice && <p role="status" className="rounded-lg bg-accent px-4 py-3 text-sm leading-6 text-accent-foreground">{notice}</p>}
          {generatedUsername && (
            <GeneratedHandle username={generatedUsername} onDismiss={() => setGeneratedUsername('')} />
          )}
          <Button
            className="auth-submit flex w-full items-center justify-center gap-2 rounded-full bg-primary px-5 py-3.5 font-semibold text-primary-foreground transition hover:brightness-95 disabled:cursor-wait disabled:opacity-70"
            disabled={busy}
            type="submit"
          >
            {busy && <LoaderCircle className="animate-spin" size={18} />}
            {isRegister ? 'Create account' : 'Sign in'}
          </Button>
        </form>
        <div className="mt-7 flex items-center justify-center gap-1 border-t border-border/50 pt-5 text-sm text-muted-foreground">
          <span>{isRegister ? 'Already have a handle?' : 'New to Sloppy?'}</span>
          <Button
            className="rounded-full px-2 py-1 font-semibold text-primary hover:bg-accent/60"
            onClick={() => {
              setMode(isRegister ? 'login' : 'register')
              setError('')
              setNotice('')
              setGeneratedUsername('')
            }}
            type="button"
          >
            {isRegister ? 'Sign in' : 'Create account'}
          </Button>
        </div>
        <a
          className="mt-4 flex flex-col items-center gap-1 text-xs text-muted-foreground transition hover:text-primary"
          href="https://github.com/nari442/SloppyChat"
          rel="noreferrer"
          target="_blank"
        >
          <span className="inline-flex items-center gap-1.5 font-semibold"><Github size={14} /> Open source on GitHub</span>
          <span>Free to use, modify, and share under the MIT License</span>
        </a>
      </Card>
    </main>
  )
}

function PasswordRequirements({ password }: { password: string }) {
  const requirements = getPasswordRequirements(password)
  const rules = [
    { label: '12 characters minimum', met: requirements.minimumLength },
    { label: 'One uppercase letter', met: requirements.uppercase },
    { label: 'One lowercase letter', met: requirements.lowercase },
    { label: 'One number', met: requirements.number },
    { label: 'One special character', met: requirements.specialCharacter },
  ]

  return (
    <ul aria-label="Password requirements" className="grid grid-cols-2 gap-x-3 gap-y-1.5 rounded-lg bg-muted p-3 text-xs" aria-live="polite">
      {rules.map((rule) => (
        <li className={`flex items-center gap-1.5 ${rule.met ? 'text-primary' : 'text-muted-foreground'}`} key={rule.label}>
          <Check aria-hidden="true" size={13} className={rule.met ? '' : 'opacity-30'} />
          {rule.label}
        </li>
      ))}
    </ul>
  )
}

function GeneratedHandle({ username, onDismiss }: { username: string; onDismiss: () => void }) {
  const [copied, setCopied] = useState(false)
  const [copyError, setCopyError] = useState('')
  async function copyHandle() {
    setCopyError('')
    try {
      await navigator.clipboard.writeText(username)
      setCopied(true)
    } catch (reason) {
      setCopyError(messageFromError(reason))
    }
  }
  return (
    <div className="rounded-lg border border-border bg-muted p-4">
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Your shareable handle</span>
        <Button aria-label="Dismiss handle" className="rounded-full p-1 text-muted-foreground hover:bg-secondary" onClick={onDismiss} type="button">
          <X size={16} />
        </Button>
      </div>
      <div className="mt-2 flex items-center justify-between gap-3">
        <code className="text-lg font-semibold tracking-[0.12em] text-foreground">{username}</code>
        <Button className="flex items-center gap-1.5 rounded-full bg-accent px-3 py-2 text-sm font-semibold text-accent-foreground" onClick={copyHandle} type="button">
          {copied ? <Check size={16} /> : <Copy size={16} />}
          {copied ? 'Copied' : 'Copy'}
        </Button>
      </div>
      <p className="mt-2 text-xs leading-5 text-muted-foreground">Save this handle. Password-only accounts cannot recover a lost handle by email.</p>
      {copyError && <p className="mt-2 text-xs text-destructive" role="alert">{copyError}</p>}
    </div>
  )
}

function Workspace({
  client,
  session,
  theme,
  onThemeChange,
  accentColor,
  onAccentColorChange,
  route,
  onNavigate
}: {
  client: SupabaseClient
  session: Session
  theme: ThemePreference
  onThemeChange: (theme: ThemePreference) => void
  accentColor: string
  onAccentColorChange: (color: AccentColor) => void
  route: AppRoute
  onNavigate: (route: AppRoute) => void
}) {
  const userId = session.user.id
  const [username, setUsername] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [deviceState, setDeviceState] = useState<DeviceState | null>(null)
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [conversationPreferences, setConversationPreferences] = useState<Record<string, ConversationPreference>>({})
  const [selectedId, setSelectedId] = useState('')
  const [loading, setLoading] = useState(true)
  const [nicknameStorage, setNicknameStorage] = useState(() => loadConversationNicknames(userId))
  const [error, setError] = useState(nicknameStorage.error)
  const [newChatOpen, setNewChatOpen] = useState(false)
  const [messageRequestsOpen, setMessageRequestsOpen] = useState(false)
  const [messageRequests, setMessageRequests] = useState<IncomingMessageRequest[]>([])
  const [devicesOpen, setDevicesOpen] = useState(false)
  const [mobileChatOpen, setMobileChatOpen] = useState(false)
  const [busyDeviceId, setBusyDeviceId] = useState('')
  const [handleCopied, setHandleCopied] = useState(false)
  const [nicknameConversationId, setNicknameConversationId] = useState('')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [actionConversationId, setActionConversationId] = useState('')
  const [safetyCodesOpenFor, setSafetyCodesOpenFor] = useState('')
  const [addingGroupMembersToId, setAddingGroupMembersToId] = useState('')
  const [notificationsEnabled, setNotificationsEnabled] = useState(() => (
    window.localStorage.getItem(`sloppy-notifications:${userId}`) === 'true'
  ))

  useEffect(() => {
    if (loading || deviceState?.status !== 'active') return

    if (route.type === 'home') {
      setSelectedId('')
      setMobileChatOpen(false)
      setNewChatOpen(false)
      return
    }

    const targetConversation = route.type === 'direct-chat'
      ? conversations.find((conversation) => (
        conversation.kind === 'direct'
        && conversation.conversation_members.some((member) => memberUsername(member) === route.handle)
      ))
      : conversations.find((conversation) => conversation.id === route.conversationId)

    if (targetConversation) {
      setSelectedId(targetConversation.id)
      setMobileChatOpen(true)
      setNewChatOpen(false)
    } else if (route.type === 'direct-chat') {
      setSelectedId('')
      setMobileChatOpen(true)
      setNewChatOpen(true)
    } else {
      setError('That group conversation is not available on this account.')
      onNavigate({ type: 'home' })
    }
  }, [conversations, deviceState?.status, loading, onNavigate, route])

  useEffect(() => {
    let active = true
    async function prepareWorkspace() {
      setLoading(true)
      try {
        const { data, error: profileError } = await client.rpc('ensure_my_profile')
        if (profileError) {
          throw new Error(workspaceErrorMessage(profileError))
        }
        const profile = ((data ?? []) as Array<{ username: string; display_name: string }>)[0]
        if (!profile) throw new Error('Your Sloppy profile could not be created or loaded.')
        const handle = profile.username
        const preferredName = profile.display_name || handle
        const nextDeviceState = await activateOrRequestDevice(client, userId, handle)
        if (!active) {
          return
        }
        setUsername(handle)
        setDisplayName(preferredName || handle)
        setDeviceState(nextDeviceState)
        if (nextDeviceState.status === 'active') {
          const [nextConversations, preferences] = await Promise.all([
            loadConversations(client),
            loadConversationPreferences(client)
          ])
          setConversations(nextConversations)
          setConversationPreferences(Object.fromEntries(preferences.map((preference) => [preference.conversation_id, preference])))
        }
      } catch (reason) {
        if (active) {
          setError(workspaceErrorMessage(reason))
        }
      } finally {
        if (active) {
          setLoading(false)
        }
      }
    }
    void prepareWorkspace()
    return () => {
      active = false
    }
  }, [client, userId])

  useEffect(() => {
    if (deviceState?.status !== 'active') {
      return
    }
    let active = true
    const channel = client
      .channel(`sloppy-members:${userId}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'conversation_members',
        filter: `user_id=eq.${userId}`
      }, () => {
        void loadConversations(client)
          .then((nextConversations) => {
            if (active) {
              setConversations(nextConversations)
            }
          })
          .catch((reason: unknown) => {
            if (active) {
              setError(messageFromError(reason))
            }
          })
      })
      .subscribe((status) => {
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          setError('Conversation updates could not connect through Supabase Realtime.')
        }
      })
    return () => {
      active = false
      void client.removeChannel(channel)
    }
  }, [client, deviceState?.status, userId])

  useEffect(() => {
    if (deviceState?.status !== 'active') {
      return
    }
    let active = true
    const refreshRequests = () => loadIncomingMessageRequests(client)
      .then((requests) => {
        if (active) {
          setMessageRequests(requests)
        }
      })
      .catch((reason: unknown) => {
        if (active) {
          setError(messageFromError(reason))
        }
      })
    void refreshRequests()
    const channel = client
      .channel(`sloppy-requests:${userId}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'message_requests',
        filter: `recipient_id=eq.${userId}`
      }, () => {
        if (notificationsEnabled && document.hidden && 'Notification' in window && Notification.permission === 'granted') {
          new Notification('New message request', { body: 'Open Sloppy to review it.' })
        }
        void refreshRequests()
      })
      .subscribe((status) => {
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          setError('Message request updates could not connect. Refresh the inbox to check again.')
        }
      })
    return () => {
      active = false
      void client.removeChannel(channel)
    }
  }, [client, deviceState?.status, notificationsEnabled, userId])

  async function signOut() {
    const { error: signOutError } = await client.auth.signOut()
    if (signOutError) {
      setError(`Could not sign out: ${signOutError.message}`)
    }
  }

  async function copyHandle() {
    try {
      await navigator.clipboard.writeText(username)
      setHandleCopied(true)
    } catch (reason) {
      setError(messageFromError(reason))
    }
  }

  async function refreshConversations(nextId?: string) {
    const [nextConversations, preferences] = await Promise.all([
      loadConversations(client),
      loadConversationPreferences(client)
    ])
    setConversations(nextConversations)
    setConversationPreferences(Object.fromEntries(preferences.map((preference) => [preference.conversation_id, preference])))
    if (nextId) {
      setSelectedId(nextId)
      setMobileChatOpen(true)
      const selectedConversation = nextConversations.find((conversation) => conversation.id === nextId)
      if (selectedConversation) onNavigate(routeForConversation(selectedConversation, userId))
    }
  }

  function routeForConversation(conversation: Conversation, currentUserId: string): AppRoute {
    if (conversation.kind === 'group') {
      return { type: 'group-chat', conversationId: conversation.id }
    }
    const peerHandle = conversation.conversation_members
      .filter((member) => member.user_id !== currentUserId)
      .map(memberUsername)
      .find((handle): handle is string => Boolean(handle && isValidUsername(handle)))
    return peerHandle ? { type: 'direct-chat', handle: peerHandle } : { type: 'home' }
  }

  async function refreshDeviceRequests() {
    const { data, error: devicesError } = await client.rpc('get_my_devices')
    if (devicesError) {
      throw new Error(`Could not refresh device requests: ${devicesError.message}`)
    }
    const devices = (data ?? []) as StoredDevice[]
    setDeviceState((current) => current?.status === 'active'
      ? {
          ...current,
          pendingDevices: devices.filter((device) => !device.approved_at),
          trustedDevices: devices.filter((device) => device.approved_at && !device.revoked_at)
        }
      : current)
  }

  async function approvePendingDevice(target: StoredDevice) {
    if (!deviceState || deviceState.status !== 'active') {
      return
    }
    setBusyDeviceId(target.device_id)
    setError('')
    try {
      await approveDevice(client, deviceState.vault, target)
      await refreshDeviceRequests()
    } catch (reason) {
      setError(messageFromError(reason))
      throw reason
    } finally {
      setBusyDeviceId('')
    }
  }

  async function revokeTrustedDevice(target: StoredDevice) {
    if (!deviceState || deviceState.status !== 'active') {
      return
    }
    if (!window.confirm(`Revoke ${target.label}? It will not receive future messages.`)) {
      return
    }
    setBusyDeviceId(target.device_id)
    setError('')
    try {
      await revokeDevice(client, deviceState.vault, target.device_id)
      await refreshDeviceRequests()
    } catch (reason) {
      setError(messageFromError(reason))
      throw reason
    } finally {
      setBusyDeviceId('')
    }
  }

  async function checkEnrollment() {
    setLoading(true)
    setError('')
    try {
      const state = await activateOrRequestDevice(client, userId, username)
      setDeviceState(state)
      if (state.status === 'active') {
        const [nextConversations, preferences] = await Promise.all([
          loadConversations(client),
          loadConversationPreferences(client)
        ])
        setConversations(nextConversations)
        setConversationPreferences(Object.fromEntries(preferences.map((preference) => [preference.conversation_id, preference])))
      }
    } catch (reason) {
      setError(messageFromError(reason))
    } finally {
      setLoading(false)
    }
  }

  async function startConversation(handles: string[], title: string, firstMessage: string) {
    if (handles.length === 1) {
      const handle = handles[0]
      if (handle === username) {
        throw new Error('You cannot start a conversation with your own handle.')
      }
      const existing = conversations.find((conversation) => (
        conversation.kind === 'direct'
        && conversation.conversation_members.some((member) => memberUsername(member) === handle)
      ))
      if (existing) {
        if (!deviceState || deviceState.status !== 'active') {
          throw new Error('This browser is not ready to send messages.')
        }
        await sendMessage(
          client,
          existing.id,
          userId,
          existing.conversation_members.map((member) => member.user_id),
          deviceState.vault,
          firstMessage
        )
        await refreshConversations(existing.id)
        return
      }
      if (!deviceState || deviceState.status !== 'active') {
        throw new Error('This browser is not ready to send message requests.')
      }
      await sendMessageRequest(client, handle, userId, username, deviceState.vault, firstMessage)
      setMessageRequests(await loadIncomingMessageRequests(client))
      return
    }
    const id = await createConversation(client, handles, title)
    await refreshConversations(id)
  }

  async function handleMessageRequest(request: IncomingMessageRequest, action: 'accept' | 'deny' | 'block') {
    await respondToMessageRequest(client, request.request_id, action)
    setMessageRequests(await loadIncomingMessageRequests(client))
    if (action === 'accept') {
      await refreshConversations(request.request_id)
    }
  }

  if (loading) {
    return <LoadingScreen label="Preparing your encrypted workspace" />
  }

  if (error && !deviceState) {
    return <ProblemScreen error={error} onSignOut={signOut} />
  }

  if (deviceState?.status === 'pending') {
    return (
      <main className="grid min-h-screen place-items-center bg-background px-5 py-10">
        <section className="w-full max-w-lg rounded-xl bg-card p-8 shadow-lift sm:p-10">
          <BrandMark />
          <div className="mt-8 grid h-14 w-14 place-items-center rounded-lg bg-muted text-foreground">
            <Smartphone size={25} />
          </div>
          <h1 className="mt-5 text-2xl font-semibold text-foreground">Approve this browser</h1>
          <p className="mt-3 leading-7 text-muted-foreground">
            Sign in on a trusted device for <strong className="font-semibold text-foreground">{username}</strong>. Compare this device code with the pending request before approving it.
          </p>
          <div className="mt-4 rounded-lg bg-muted p-4">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">New browser code</p>
            <code className="mt-2 block break-all text-sm font-semibold tracking-wide text-foreground">{deviceState.vault.deviceId}</code>
            <p className="mt-2 text-xs leading-5 text-muted-foreground">Approval grants access to future messages only.</p>
          </div>
          {error && <p role="alert" className="mt-4 rounded-lg bg-destructive/10 px-4 py-3 text-sm text-destructive">{error}</p>}
          <Button className="mt-6 flex w-full items-center justify-center gap-2 rounded-full bg-primary px-5 py-3.5 font-semibold text-primary-foreground" onClick={checkEnrollment} type="button">
            Check approval
          </Button>
          <Button className="mt-3 w-full rounded-full px-5 py-3 text-sm font-semibold text-muted-foreground hover:bg-muted" onClick={signOut} type="button">
            Sign out
          </Button>
        </section>
      </main>
    )
  }

  if (!deviceState || deviceState.status !== 'active') {
    return <ProblemScreen error={error || 'No trusted device is available.'} onSignOut={signOut} />
  }

  const selectedConversation = conversations.find((conversation) => conversation.id === selectedId)
  const editingNicknameConversation = conversations.find((conversation) => conversation.id === nicknameConversationId)
  const actionConversation = conversations.find((conversation) => conversation.id === actionConversationId)
  const addingGroupMembersTo = conversations.find((conversation) => conversation.id === addingGroupMembersToId)
  const savedNicknames = nicknameStorage.values
  const pendingCount = deviceState.pendingDevices.length
  const visibleConversations = conversations.filter((conversation) => !conversationPreferences[conversation.id]?.hidden_at)
  const acceptedContacts = [...new Map(conversations
    .filter((conversation) => conversation.kind === 'direct')
    .flatMap((conversation) => conversation.conversation_members
      .filter((member) => member.user_id !== userId)
      .map((member) => {
        const handle = memberUsername(member)
        if (!handle) return null
        return [member.user_id, {
          userId: member.user_id,
          username: handle,
          displayName: memberDisplayName(member) ?? handle
        }] as const
      })
      .filter((entry): entry is readonly [string, ContactOption] => entry !== null))
  ).values()]

  function saveConversationNickname(conversationId: string, nickname: string) {
    const next = { ...nicknameStorage.values }
    if (nickname) {
      next[conversationId] = nickname
    } else {
      delete next[conversationId]
    }
    try {
      window.localStorage.setItem(`sloppy-conversation-nicknames:${userId}`, JSON.stringify(next))
      setNicknameStorage({ values: next, error: '' })
      setError('')
    } catch (reason) {
      setError(`Could not save local conversation nicknames: ${messageFromError(reason)}`)
    }
    setNicknameConversationId('')
  }

  async function changeNotificationPreference(enabled: boolean) {
    setError('')
    if (enabled) {
      if (!('Notification' in window)) {
        setError('Browser notifications are not available in this browser.')
        return
      }
      let permission = Notification.permission
      if (permission === 'default') permission = await Notification.requestPermission()
      if (permission !== 'granted') {
        setError('Allow browser notifications in your browser settings to enable them here.')
        return
      }
    }
    try {
      window.localStorage.setItem(`sloppy-notifications:${userId}`, String(enabled))
      setNotificationsEnabled(enabled)
    } catch (reason) {
      setError(`Could not save notification settings: ${messageFromError(reason)}`)
    }
  }

  async function hideConversationFromMe(conversation: Conversation) {
    await hideConversation(client, conversation.id)
    setConversationPreferences((current) => ({
      ...current,
      [conversation.id]: {
        conversation_id: conversation.id,
        hidden_at: new Date().toISOString(),
        cleared_at: current[conversation.id]?.cleared_at ?? null
      }
    }))
    setActionConversationId('')
    if (selectedId === conversation.id) {
      setSelectedId('')
      setMobileChatOpen(false)
      onNavigate({ type: 'home' })
    }
  }

  async function clearConversationForMe(conversation: Conversation) {
    const clearedAt = await clearConversation(client, conversation.id)
    setConversationPreferences((current) => ({
      ...current,
      [conversation.id]: {
        conversation_id: conversation.id,
        hidden_at: current[conversation.id]?.hidden_at ?? null,
        cleared_at: clearedAt
      }
    }))
    setActionConversationId('')
  }

  async function deleteConversationForEveryone(conversation: Conversation) {
    await deleteDirectConversationForEveryone(client, conversation.id)
    setConversations((current) => current.filter((entry) => entry.id !== conversation.id))
    setConversationPreferences((current) => {
      const next = { ...current }
      delete next[conversation.id]
      return next
    })
    setActionConversationId('')
    if (selectedId === conversation.id) {
      setSelectedId('')
      setMobileChatOpen(false)
      onNavigate({ type: 'home' })
    }
  }

  async function blockConversationUser(conversation: Conversation, targetUserId: string) {
    await blockUser(client, targetUserId)
    setActionConversationId('')
    if (selectedId === conversation.id) {
      setSelectedId('')
      setMobileChatOpen(false)
      onNavigate({ type: 'home' })
    }
    await refreshConversations()
  }

  async function addMembersToGroup(conversation: Conversation, userIds: string[]) {
    await addGroupMembers(client, conversation.id, userIds)
    await refreshConversations()
  }

  return (
    <main className="h-[100dvh] w-full overflow-hidden bg-background text-foreground">
      <div className="app-shell flex h-full w-full overflow-hidden bg-card">
        <aside className={`app-sidebar ${mobileChatOpen ? 'hidden md:flex' : 'flex'} w-full shrink-0 flex-col border-r border-border/60 bg-muted md:w-[320px] lg:w-[360px]`}>
          <header className="flex items-center justify-between px-5 pb-4 pt-5">
            <BrandMark />
            <Button
              aria-label="Manage trusted devices"
              className="relative grid h-11 w-11 place-items-center rounded-full text-muted-foreground transition hover:bg-secondary"
              onClick={() => {
                setDevicesOpen(true)
                void refreshDeviceRequests().catch((reason: unknown) => setError(messageFromError(reason)))
              }}
              type="button"
            >
              <Smartphone size={19} />
              {pendingCount > 0 && <span className="absolute right-2 top-2 h-2.5 w-2.5 rounded-full bg-destructive ring-2 ring-muted" />}
            </Button>
          </header>
          <div className="px-5 pb-4">
            <div className="flex items-center gap-2 rounded-lg bg-card px-4 py-3 text-sm text-muted-foreground">
              <Search size={17} />
              <span className="truncate">Your handle</span>
              <code className="ml-auto truncate font-semibold tracking-wider text-foreground"><Handle value={username} /></code>
              <Button aria-label="Copy your Sloppy username" className="rounded-full p-1.5 text-primary hover:bg-accent/60" onClick={() => void copyHandle()} type="button">
                {handleCopied ? <Check size={15} /> : <Copy size={15} />}
              </Button>
            </div>
          </div>
          <div className="flex items-center justify-between px-5 pb-3">
            <h2 className="text-sm font-semibold text-muted-foreground">Conversations</h2>
            <Button
              aria-label="New conversation"
              className="grid h-10 w-10 place-items-center rounded-lg bg-accent text-accent-foreground shadow-sm transition hover:scale-[1.03]"
              onClick={() => setNewChatOpen(true)}
              type="button"
            >
              <Plus size={19} />
            </Button>
          </div>
          <div className="px-4 pb-3">
            <Button
              className="flex w-full items-center justify-between rounded-lg bg-card px-4 py-3 text-left text-sm font-semibold text-card-foreground transition hover:bg-secondary"
              onClick={() => {
                setMessageRequestsOpen(true)
                void loadIncomingMessageRequests(client)
                  .then(setMessageRequests)
                  .catch((reason: unknown) => setError(messageFromError(reason)))
              }}
              type="button"
            >
              <span>Message Requests</span>
              {messageRequests.length > 0 && (
                <span className="grid min-h-6 min-w-6 place-items-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
                  {messageRequests.length}
                </span>
              )}
            </Button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
            {visibleConversations.length === 0 ? (
              <div className="empty-state mx-2 mt-4 rounded-xl bg-card p-5 text-center">
                <MessageCircle className="mx-auto text-primary" size={25} />
                <p className="mt-3 text-sm font-semibold text-foreground">Start a conversation</p>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">Find someone by their generated Sloppy username.</p>
              </div>
            ) : visibleConversations.map((conversation) => {
              const members = conversation.conversation_members.length
              return (
                <div className="conversation-item mb-1.5 flex items-center rounded-lg" key={conversation.id}>
                  <Button
                    className={`flex min-w-0 flex-1 items-center gap-3 rounded-lg px-3 py-3 text-left transition ${selectedId === conversation.id ? 'bg-accent/75' : 'hover:bg-card'}`}
                    onClick={() => {
                      setSelectedId(conversation.id)
                      setMobileChatOpen(true)
                      onNavigate(routeForConversation(conversation, userId))
                    }}
                    type="button"
                  >
                    <div className="grid h-12 w-12 shrink-0 place-items-center rounded-lg bg-card text-primary">
                      {conversation.kind === 'group' ? <Users size={20} /> : <MessageCircle size={20} />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-foreground">
                        <ConversationLabel conversation={conversation} currentUserId={userId} nickname={savedNicknames[conversation.id]} />
                      </p>
                      <p className="mt-1 truncate text-xs text-muted-foreground">
                        {conversation.kind === 'group' ? `${members} members · Encrypted` : 'Encrypted conversation'}
                      </p>
                    </div>
                    <ChevronDown className="-rotate-90 text-border" size={16} />
                  </Button>
                  <Button aria-label="Conversation actions" className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-card" onClick={() => setActionConversationId(conversation.id)} title="Conversation actions" type="button">
                    <MoreHorizontal size={18} />
                  </Button>
                </div>
              )
            })}
          </div>
          <footer className="flex items-center justify-between border-t border-border/60 px-5 py-4">
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold"><Handle value={username} /></p>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <Button aria-label="Settings" className="grid h-10 w-10 place-items-center rounded-full text-muted-foreground hover:bg-card" onClick={() => setSettingsOpen(true)} title="Settings" type="button">
                <Settings size={18} />
              </Button>
              <Button aria-label="Sign out" className="grid h-10 w-10 place-items-center rounded-full text-muted-foreground hover:bg-card" onClick={signOut} title="Sign out" type="button">
                <LogOut size={18} />
              </Button>
            </div>
          </footer>
        </aside>
        <section className={`${mobileChatOpen ? 'flex' : 'hidden md:flex'} min-w-0 flex-1 flex-col bg-card`}>
          {selectedConversation && deviceState ? (
            <ChatRoom
              key={selectedConversation.id}
              client={client}
              conversation={selectedConversation}
              onBack={() => {
                setSelectedId('')
                setMobileChatOpen(false)
                onNavigate({ type: 'home' })
              }}
              onError={setError}
              session={session}
              vault={deviceState.vault}
              nickname={savedNicknames[selectedConversation.id]}
              clearedAt={conversationPreferences[selectedConversation.id]?.cleared_at}
              notificationsEnabled={notificationsEnabled}
              onEditNickname={() => setNicknameConversationId(selectedConversation.id)}
              onManageConversation={() => {
                setSafetyCodesOpenFor('')
                setActionConversationId(selectedConversation.id)
              }}
              showSafetyCodes={safetyCodesOpenFor === selectedConversation.id}
              onCloseSafetyCodes={() => setSafetyCodesOpenFor('')}
            />
          ) : (
            <div className="grid flex-1 place-items-center px-6 py-10">
              <div className="empty-state max-w-sm text-center">
                <div className="mx-auto grid h-20 w-20 place-items-center rounded-xl bg-accent text-accent-foreground">
                  <LockKeyhole size={32} />
                </div>
                <h1 className="mt-6 text-2xl font-semibold tracking-tight">A quieter kind of chat</h1>
                <p className="mt-3 leading-7 text-muted-foreground">Choose a conversation or start a new one. Messages are encrypted in your browser before they reach Supabase.</p>
                <Button className="mt-6 inline-flex items-center gap-2 rounded-full bg-primary px-5 py-3 font-semibold text-primary-foreground shadow-sm" onClick={() => setNewChatOpen(true)} type="button">
                  <Plus size={18} />
                  New conversation
                </Button>
              </div>
            </div>
          )}
        </section>
      </div>
      <ErrorToast error={error} onDismiss={() => setError('')} />
      {newChatOpen && (
        <NewConversationDialog
          initialHandle={route.type === 'direct-chat' ? route.handle : ''}
          acceptedContacts={acceptedContacts}
          onClose={() => {
            setNewChatOpen(false)
            const existing = route.type === 'direct-chat' && conversations.some((conversation) => (
              conversation.kind === 'direct'
              && conversation.conversation_members.some((member) => memberUsername(member) === route.handle)
            ))
            if (!existing && route.type !== 'group-chat') onNavigate({ type: 'home' })
          }}
          onCreate={startConversation}
        />
      )}
      {devicesOpen && (
        <DeviceDialog
          busyDeviceId={busyDeviceId}
          onApprove={approvePendingDevice}
          onClose={() => setDevicesOpen(false)}
          onRevoke={revokeTrustedDevice}
          onRefresh={refreshDeviceRequests}
          currentDeviceId={deviceState.vault.deviceId}
          pendingDevices={deviceState.pendingDevices}
          trustedDevices={deviceState.trustedDevices}
        />
      )}
      {editingNicknameConversation && (
        <NicknameDialog
          conversation={editingNicknameConversation}
          currentUserId={userId}
          nickname={savedNicknames[editingNicknameConversation.id] ?? ''}
          onClose={() => setNicknameConversationId('')}
          onSave={(nickname) => saveConversationNickname(editingNicknameConversation.id, nickname)}
        />
      )}
      {messageRequestsOpen && deviceState.status === 'active' && (
        <MessageRequestsDialog
          client={client}
          onClose={() => setMessageRequestsOpen(false)}
          onRespond={handleMessageRequest}
          requests={messageRequests}
          vault={deviceState.vault}
        />
      )}
      {settingsOpen && (
        <SettingsDialog
          client={client}
          notificationsEnabled={notificationsEnabled}
          onClose={() => setSettingsOpen(false)}
          onNotificationsChange={(enabled) => void changeNotificationPreference(enabled)}
          onOpenDevices={() => {
            setSettingsOpen(false)
            setDevicesOpen(true)
            void refreshDeviceRequests().catch((reason: unknown) => setError(messageFromError(reason)))
          }}
          onOpenRequests={() => {
            setSettingsOpen(false)
            setMessageRequestsOpen(true)
            void loadIncomingMessageRequests(client)
              .then(setMessageRequests)
              .catch((reason: unknown) => setError(messageFromError(reason)))
          }}
          onThemeChange={onThemeChange}
          accentColor={accentColor}
          onAccentColorChange={onAccentColorChange}
          onDisplayNameChange={setDisplayName}
          theme={theme}
          displayName={displayName}
          username={username}
        />
      )}
      {actionConversation && (
        <ConversationActionsDialog
          conversation={actionConversation}
          currentUserId={userId}
          nickname={savedNicknames[actionConversation.id] ?? ''}
          onBlock={(targetUserId) => blockConversationUser(actionConversation, targetUserId)}
          onAddMembers={() => {
            setActionConversationId('')
            setAddingGroupMembersToId(actionConversation.id)
          }}
          onClear={() => clearConversationForMe(actionConversation)}
          onClose={() => setActionConversationId('')}
          onViewSafetyCodes={actionConversation.id === selectedId
            ? () => setSafetyCodesOpenFor(actionConversation.id)
            : undefined}
          onDeleteForEveryone={() => deleteConversationForEveryone(actionConversation)}
          onHide={() => hideConversationFromMe(actionConversation)}
          onRename={() => {
            setActionConversationId('')
            setNicknameConversationId(actionConversation.id)
          }}
        />
      )}
      {addingGroupMembersTo && (
        <AddGroupMembersDialog
          availableContacts={acceptedContacts.filter((contact) => !addingGroupMembersTo.conversation_members.some((member) => member.user_id === contact.userId))}
          currentMemberCount={addingGroupMembersTo.conversation_members.length}
          onAdd={(userIds) => addMembersToGroup(addingGroupMembersTo, userIds)}
          onClose={() => setAddingGroupMembersToId('')}
        />
      )}
    </main>
  )
}

function ChatRoom({
  client,
  conversation,
  onBack,
  onError,
  session,
  vault,
  nickname,
  clearedAt,
  notificationsEnabled,
  onEditNickname,
  onManageConversation,
  showSafetyCodes,
  onCloseSafetyCodes
}: {
  client: SupabaseClient
  conversation: Conversation
  onBack: () => void
  onError: (message: string) => void
  session: Session
  vault: DeviceVault
  nickname?: string
  clearedAt?: string | null
  notificationsEnabled: boolean
  onEditNickname: () => void
  onManageConversation: () => void
  showSafetyCodes: boolean
  onCloseSafetyCodes: () => void
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [draft, setDraft] = useState('')
  const [imageFile, setImageFile] = useState<File | null>(null)
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const [peerIdentities, setPeerIdentities] = useState<PeerIdentity[]>([])
  const [localVault, setLocalVault] = useState(vault)
  const messageEnd = useRef<HTMLDivElement>(null)
  const draftField = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    const field = draftField.current
    if (!field) {
      return
    }
    field.style.height = 'auto'
    field.style.height = `${Math.min(field.scrollHeight, 144)}px`
    field.style.overflowY = field.scrollHeight > 144 ? 'auto' : 'hidden'
  }, [draft])

  useEffect(() => {
    let active = true
    const channel = client
      .channel(`sloppy:${conversation.id}:${localVault.deviceId}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'messages',
        filter: `conversation_id=eq.${conversation.id}`
      }, (payload) => {
        const row = payload.new as unknown as StoredMessage
        if (clearedAt && row.created_at <= clearedAt) {
          return
        }
        void loadConversationDevices(client, conversation.id)
          .then((devices) => decryptRealtimeMessage(conversation.id, localVault, row, devices))
          .then((message) => {
            if (active) {
              if (
                notificationsEnabled
                && message.sender_id !== session.user.id
                && document.hidden
                && 'Notification' in window
                && Notification.permission === 'granted'
              ) {
                new Notification('New encrypted message', { body: 'Open Sloppy to read it.', tag: conversation.id })
              }
              setMessages((current) => current.some((item) => item.id === message.id) ? current : [...current, message])
            }
          })
          .catch((reason: unknown) => {
            if (active) {
              onError(messageFromError(reason))
            }
          })
      })
      .subscribe((status) => {
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          onError('Realtime connection failed. Check your Supabase Realtime setup and reconnect.')
        }
      })
    const devicesPromise = loadConversationDevices(client, conversation.id)
    Promise.all([
      devicesPromise,
      devicesPromise.then((devices) => loadMessages(client, conversation.id, localVault, devices, clearedAt))
    ])
      .then(async ([devices, loaded]) => {
        if (active) {
          setMessages((current) => {
            const visible = current.filter((message) => !clearedAt || message.created_at > clearedAt)
            const byId = new Map(visible.map((message) => [message.id, message]))
            for (const message of loaded) {
              byId.set(message.id, message)
            }
            return [...byId.values()].sort((left, right) => left.created_at.localeCompare(right.created_at))
          })
          const expectedPeers = conversation.conversation_members.filter((member) => member.user_id !== session.user.id)
          const identities = await Promise.all(expectedPeers.map(async (member) => {
            const displayName = memberDisplayName(member)
            const userDevices = devices.filter((candidate) => candidate.userId === member.user_id)
            const device = userDevices[0]
            if (!device) {
              return {
                userId: member.user_id,
                username: displayName ?? 'Group member',
                fingerprint: '',
                status: 'missing' as const
              }
            }
            const fingerprints = await Promise.all(userDevices.map((candidate) => identityFingerprint(candidate.identitySigningPublic)))
            const fingerprint = fingerprints[0]
            if (new Set(fingerprints).size !== 1) {
              return {
                userId: member.user_id,
                username: displayName ?? device.username,
                fingerprint,
                status: 'conflict' as const
              }
            }
            const pin = localVault.peerPins?.[member.user_id]
            return {
              userId: member.user_id,
              username: displayName ?? device.username,
              fingerprint,
              status: pin === fingerprint ? 'verified' as const : pin ? 'changed' as const : 'unverified' as const
            }
          }))
          setPeerIdentities(identities)
        }
      })
      .catch((reason: unknown) => {
        if (active) {
          onError(messageFromError(reason))
        }
      })
      .finally(() => {
        if (active) {
          setLoading(false)
        }
      })
    return () => {
      active = false
      void client.removeChannel(channel)
    }
  }, [client, conversation, clearedAt, localVault, notificationsEnabled, onError, session.user.id])

  useEffect(() => {
    messageEnd.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  async function submitMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const text = draft.trim()
    if ((!text && !imageFile) || sending) {
      return
    }
    setSending(true)
    try {
      const expectedUserIds = conversation.conversation_members.map((member) => member.user_id)
      let payload = text
      if (imageFile) {
        payload = await uploadEncryptedImage(client, conversation.id, session.user.id, imageFile, text)
      }
      let message: ChatMessage
      try {
        message = await sendMessage(client, conversation.id, session.user.id, expectedUserIds, localVault, payload)
      } catch (reason) {
        if (imageFile) {
          await removeUploadedImage(client, payload).catch(() => undefined)
        }
        throw reason
      }
      setMessages((current) => current.some((item) => item.id === message.id) ? current : [...current, message])
      setDraft('')
      setImageFile(null)
    } catch (reason) {
      onError(messageFromError(reason))
    } finally {
      setSending(false)
    }
  }

  async function trustPeer(peer: typeof peerIdentities[number]) {
    if (!peer.fingerprint || peer.status === 'missing' || peer.status === 'conflict') {
      return
    }
    try {
      const nextVault = {
        ...localVault,
        peerPins: { ...localVault.peerPins, [peer.userId]: peer.fingerprint }
      }
      await saveDeviceVault(nextVault)
      setLocalVault(nextVault)
      setPeerIdentities((current) => current.map((identity) => identity.userId === peer.userId
        ? { ...identity, status: 'verified' }
        : identity))
    } catch (reason) {
      onError(messageFromError(reason))
    }
  }

  async function copyPeerCode(peer: typeof peerIdentities[number]) {
    try {
      await navigator.clipboard.writeText(peer.fingerprint)
    } catch (reason) {
      onError(messageFromError(reason))
    }
  }

  return (
    <>
      <header className="chat-header flex items-center gap-3 border-b border-border/50 px-4 py-4 sm:px-7">
        <Button aria-label="Back to conversations" className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-muted md:hidden" onClick={onBack} type="button">
          <ArrowLeft size={19} />
        </Button>
        <div className="grid h-11 w-11 shrink-0 place-items-center rounded-lg bg-secondary text-muted-foreground">
          {conversation.kind === 'group' ? <Users size={19} /> : <MessageCircle size={19} />}
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="truncate font-semibold">
            <ConversationLabel conversation={conversation} currentUserId={session.user.id} nickname={nickname} />
          </h1>
          <p className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
            <LockKeyhole size={12} />
            End-to-end encrypted
          </p>
        </div>
        <Button
          aria-label="Edit conversation nickname"
          className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-muted"
          onClick={onEditNickname}
          title="Edit conversation nickname"
          type="button"
        >
          <Pencil size={17} />
        </Button>
        <Button aria-label="Conversation actions" className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-muted" onClick={onManageConversation} title="Conversation actions" type="button">
          <MoreHorizontal size={18} />
        </Button>
      </header>
      <div className="chat-scroll flex min-h-0 flex-1 flex-col overflow-y-auto bg-background px-4 py-5 sm:px-8">
        {loading ? (
          <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
            <LoaderCircle className="mr-2 animate-spin" size={17} /> Decrypting this device's history
          </div>
        ) : messages.length === 0 ? (
          <div className="flex flex-1 items-center justify-center text-center">
            <div className="max-w-xs">
              <div className="mx-auto grid h-14 w-14 place-items-center rounded-lg bg-accent text-accent-foreground"><LockKeyhole size={22} /></div>
              <p className="mt-4 font-semibold">This conversation is ready</p>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">Send the first encrypted message.</p>
            </div>
          </div>
        ) : (
          <div className="mx-auto flex w-full max-w-3xl flex-col gap-3">
            {messages.map((message) => {
              const ownMessage = message.sender_id === session.user.id
              const sender = conversation.conversation_members.find((member) => member.user_id === message.sender_id)
              const senderName = sender ? memberDisplayName(sender) : undefined
              const imageAttachment = parseImageAttachment(message.text)
              return (
                <div className={`message-row flex ${ownMessage ? 'justify-end' : 'justify-start'}`} key={message.id}>
                  <div className={`max-w-[85%] rounded-xl px-4 py-3 sm:max-w-[75%] ${ownMessage ? 'rounded-br-lg bg-primary text-primary-foreground' : 'rounded-bl-lg bg-secondary text-card-foreground'}`}>
                    {!ownMessage && conversation.kind === 'group' && (
                      <p className="mb-1 text-[11px] font-semibold text-primary">
                        {senderName ? <Handle value={senderName} /> : 'Group member'}
                      </p>
                    )}
                    {imageAttachment ? (
                      <EncryptedImageView client={client} conversationId={conversation.id} attachment={imageAttachment} />
                    ) : (
                      <p className={`whitespace-pre-wrap break-words text-sm leading-6 ${message.text === null ? 'italic opacity-75' : ''}`}>
                        {message.text ?? 'Not encrypted for this device'}
                      </p>
                    )}
                    {imageAttachment?.caption && <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6">{imageAttachment.caption}</p>}
                    <time className={`mt-1 block text-right text-[10px] ${ownMessage ? 'text-primary-foreground/70' : 'text-muted-foreground'}`} dateTime={message.created_at}>
                      {new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(new Date(message.created_at))}
                    </time>
                  </div>
                </div>
              )
            })}
            <div ref={messageEnd} />
          </div>
        )}
      </div>
      <form className="message-composer border-t border-border/50 bg-card p-4 sm:px-7 sm:py-5" onSubmit={submitMessage}>
        {imageFile && (
          <div className="mx-auto mb-2 flex max-w-3xl items-center gap-3 rounded-lg bg-muted px-4 py-2 text-xs">
            <ImagePlus className="shrink-0 text-primary" size={16} />
            <span className="min-w-0 flex-1 truncate">{imageFile.name} · {(imageFile.size / 1024).toFixed(0)} KB</span>
            <Button aria-label="Remove image attachment" className="grid h-8 w-8 place-items-center rounded-full hover:bg-card" onClick={() => setImageFile(null)} type="button"><X size={15} /></Button>
          </div>
        )}
        <div className={`message-entry mx-auto flex max-w-3xl items-end gap-3 rounded-xl bg-muted p-2 pl-4 ${draft ? 'has-draft' : ''}`}>
          <label aria-label="Attach an image up to 2 MB" className="grid h-10 w-10 shrink-0 cursor-pointer place-items-center rounded-lg text-muted-foreground hover:bg-card" title="Attach image (max 2 MB)">
            <ImagePlus size={19} />
            <Input accept="image/png,image/jpeg,image/webp,image/gif,image/avif" className="sr-only" onChange={(event) => {
              const file = event.target.files?.[0]
              event.target.value = ''
              if (!file) return
              void validateImageFile(file)
                .then(() => setImageFile(file))
                .catch((reason: unknown) => onError(messageFromError(reason)))
            }} type="file" />
          </label>
          <Textarea
            aria-label="Message"
        className="message-textarea max-h-36 min-h-11 flex-1 resize-none bg-transparent py-2.5 text-sm leading-6 placeholder:text-border"
            maxLength={4000}
            onChange={(event) => setDraft(event.target.value)}
        ref={draftField}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault()
                event.currentTarget.form?.requestSubmit()
              }
            }}
            placeholder="Write an encrypted message"
            rows={1}
            value={draft}
          />
          <Button
            aria-label="Send encrypted message"
            className="grid h-11 w-11 shrink-0 place-items-center rounded-lg bg-primary text-primary-foreground shadow-sm transition hover:brightness-95 disabled:opacity-50"
            disabled={sending || (!draft.trim() && !imageFile)}
            type="submit"
          >
            {sending ? <LoaderCircle className="animate-spin" size={18} /> : <Send size={18} />}
          </Button>
        </div>
        <p className="mx-auto mt-2 max-w-3xl px-2 text-[10px] text-muted-foreground">Enter to send · Shift + Enter for a new line</p>
      </form>
      {showSafetyCodes && (
        <SafetyCodesDialog
          peers={peerIdentities}
          loading={loading}
          onClose={onCloseSafetyCodes}
          onCopyCode={copyPeerCode}
          onTrustPeer={trustPeer}
        />
      )}
    </>
  )
}

function EncryptedImageView({
  client,
  conversationId,
  attachment
}: {
  client: SupabaseClient
  conversationId: string
  attachment: ImageAttachment
}) {
  const [imageUrl, setImageUrl] = useState('')
  const [error, setError] = useState('')
  const [shouldLoad, setShouldLoad] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const { path, key, iv, mediaType, caption } = attachment

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        setShouldLoad(true)
        observer.disconnect()
      }
    }, { rootMargin: '200px' })
    observer.observe(container)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (!shouldLoad) return
    let active = true
    let objectUrl = ''
    void decryptImageAttachment(client, conversationId, { path, key, iv, mediaType, caption })
      .then((image) => {
        objectUrl = URL.createObjectURL(image)
        if (active) setImageUrl(objectUrl)
        else URL.revokeObjectURL(objectUrl)
      })
      .catch((reason: unknown) => {
        if (active) setError(messageFromError(reason))
      })
    return () => {
      active = false
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [client, conversationId, path, key, iv, mediaType, caption, shouldLoad])

  return (
    <div className="min-h-12 min-w-12" ref={containerRef}>
      {error ? (
        <p className="text-xs text-destructive" role="alert">Image unavailable: {error}</p>
      ) : imageUrl ? (
        <img alt={caption || 'Encrypted image attachment'} className="max-h-80 max-w-full rounded-lg object-contain" loading="lazy" src={imageUrl} />
      ) : shouldLoad ? (
        <div aria-label="Decrypting image" className="grid h-32 w-48 place-items-center rounded-lg bg-muted"><LoaderCircle className="animate-spin text-primary" size={20} /></div>
      ) : (
        <div aria-label="Image will load when visible" className="h-12 w-12 rounded-lg bg-muted" />
      )}
    </div>
  )
}

function MessageRequestsDialog({
  client,
  onClose,
  onRespond,
  requests,
  vault
}: {
  client: SupabaseClient
  onClose: () => void
  onRespond: (request: IncomingMessageRequest, action: 'accept' | 'deny' | 'block') => Promise<void>
  requests: IncomingMessageRequest[]
  vault: DeviceVault
}) {
  const closeDialog = useDialogClose(onClose)
  const [selectedId, setSelectedId] = useState('')
  const [preview, setPreview] = useState<{ requestId: string; message: string; error: string } | null>(null)
  const [busyAction, setBusyAction] = useState('')
  const [error, setError] = useState('')
  const selectedRequest = requests.find((request) => request.request_id === selectedId)
  const selectedRequestId = selectedRequest?.request_id
  const selectedRequestSender = selectedRequest?.sender_username
  const selectedPreview = preview?.requestId === selectedRequestId ? preview : null

  useEffect(() => {
    if (!selectedRequestId || !selectedRequestSender) {
      return
    }
    let active = true
    void decryptIncomingMessageRequest(client, selectedRequestId, selectedRequestSender, vault)
      .then((plaintext) => {
        if (active) {
          setPreview({ requestId: selectedRequestId, message: plaintext, error: '' })
        }
      })
      .catch((reason: unknown) => {
        if (active) {
          setPreview({ requestId: selectedRequestId, message: '', error: messageFromError(reason) })
        }
      })
    return () => {
      active = false
    }
  }, [client, selectedRequestId, selectedRequestSender, vault])

  async function respond(action: 'accept' | 'deny' | 'block') {
    if (!selectedRequest) {
      return
    }
    if (action === 'block' && !window.confirm('Block this sender? They will not be able to message you again or participate in shared conversations.')) {
      return
    }
    setBusyAction(action)
    setError('')
    try {
      await onRespond(selectedRequest, action)
      if (action === 'accept') {
        closeDialog()
      } else {
        setSelectedId('')
      }
    } catch (reason) {
      setError(messageFromError(reason))
    } finally {
      setBusyAction('')
    }
  }

  return (
    <DialogFrame onClose={onClose}>
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="grid h-12 w-12 place-items-center rounded-lg bg-accent text-accent-foreground"><MessageCircle size={21} /></div>
          <h2 className="mt-4 text-xl font-semibold">Message Requests</h2>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">Open a request to preview its first message before deciding.</p>
        </div>
        <Button aria-label="Close" className="rounded-full p-2 text-muted-foreground hover:bg-secondary" onClick={() => closeDialog()} type="button"><X size={18} /></Button>
      </div>
      {!selectedRequest ? (
        <div className="mt-6 space-y-2">
          {requests.length === 0 ? (
            <div className="rounded-lg bg-muted px-4 py-6 text-center text-sm text-muted-foreground">
              No new message requests.
            </div>
          ) : requests.map((request) => (
            <Button
              className="flex w-full items-center gap-3 rounded-lg bg-muted px-4 py-3 text-left transition hover:bg-secondary"
              key={request.request_id}
              onClick={() => {
                setError('')
                setSelectedId(request.request_id)
              }}
              type="button"
            >
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-accent text-accent-foreground"><MessageCircle size={17} /></span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold">Message request</span>
                <span className="mt-1 block truncate text-xs text-muted-foreground">
                  <Handle value={request.sender_username} />
                </span>
              </span>
              <span className="text-xs text-primary">Preview</span>
            </Button>
          ))}
        </div>
      ) : (
        <div className="mt-6">
          <Button
            className="mb-4 rounded-full px-3 py-2 text-sm font-semibold text-primary hover:bg-accent/40"
            onClick={() => setSelectedId('')}
            type="button"
          >
            <span aria-hidden="true">←</span> All requests
          </Button>
          <div className="flex items-center gap-2 text-sm font-semibold">
            <span>From</span>
            <Handle value={selectedRequest.sender_username} />
          </div>
          <div className="request-message mt-4 min-h-24 whitespace-pre-wrap break-words rounded-xl rounded-bl-lg bg-muted px-4 py-4 text-sm leading-6">
            {!selectedPreview ? (
              <span className="flex items-center gap-2 text-muted-foreground"><LoaderCircle className="animate-spin" size={16} />Decrypting request</span>
            ) : selectedPreview.message}
          </div>
          <div className="mt-4 rounded-lg border border-chart-3/20 bg-muted/40 px-4 py-3 text-xs leading-5 text-foreground">
            This sender’s identity has not been independently confirmed. Be cautious with links. Comparing safety codes is optional and can help confirm the sender.
          </div>
          {(selectedPreview?.error || error) && <p className="mt-4 rounded-lg bg-destructive/10 px-4 py-3 text-sm text-destructive" role="alert">{selectedPreview?.error || error}</p>}
          <div className="mt-5 grid grid-cols-3 gap-2">
            <Button
              className="rounded-full border border-border px-3 py-3 text-sm font-semibold text-muted-foreground hover:bg-muted disabled:opacity-50"
              disabled={Boolean(busyAction)}
              onClick={() => void respond('deny')}
              type="button"
            >
              {busyAction === 'deny' ? 'Denying…' : 'Deny'}
            </Button>
            <Button
              className="rounded-full border border-destructive/40 px-3 py-3 text-sm font-semibold text-destructive hover:bg-destructive/10 disabled:opacity-50"
              disabled={Boolean(busyAction)}
              onClick={() => void respond('block')}
              type="button"
            >
              {busyAction === 'block' ? 'Blocking…' : 'Block'}
            </Button>
            <Button
              className="rounded-full bg-primary px-3 py-3 text-sm font-semibold text-primary-foreground hover:brightness-95 disabled:opacity-50"
              disabled={Boolean(busyAction) || !selectedPreview || Boolean(selectedPreview.error)}
              onClick={() => void respond('accept')}
              type="button"
            >
              {busyAction === 'accept' ? 'Accepting…' : 'Accept'}
            </Button>
          </div>
        </div>
      )}
    </DialogFrame>
  )
}

function AddGroupMembersDialog({
  availableContacts,
  currentMemberCount,
  onAdd,
  onClose
}: {
  availableContacts: ContactOption[]
  currentMemberCount: number
  onAdd: (userIds: string[]) => Promise<void>
  onClose: () => void
}) {
  const closeDialog = useDialogClose(onClose)
  const [search, setSearch] = useState('')
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const capacity = Math.max(0, 20 - currentMemberCount)
  const filteredContacts = availableContacts.filter((contact) => (
    `${contact.displayName} ${contact.username}`.toLowerCase().includes(search.trim().toLowerCase())
  ))

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (selectedIds.length === 0) {
      setError('Choose at least one member to add.')
      return
    }
    setBusy(true)
    setError('')
    try {
      await onAdd(selectedIds)
      closeDialog()
    } catch (reason) {
      setError(messageFromError(reason))
    } finally {
      setBusy(false)
    }
  }

  return (
    <DialogFrame onClose={onClose}>
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="grid h-11 w-11 place-items-center rounded-lg bg-accent text-accent-foreground"><UserPlus size={19} /></div>
          <h2 className="mt-3 text-xl font-semibold">Add group members</h2>
          <p className="mt-1 text-sm text-muted-foreground">Choose friends. Group chats support up to 20 members.</p>
        </div>
        <Button aria-label="Close" className="rounded-full p-2 text-muted-foreground hover:bg-secondary" onClick={() => closeDialog()} type="button"><X size={18} /></Button>
      </div>
      <form className="mt-5 space-y-4" onSubmit={(event) => void submit(event)}>
        <Input
          autoFocus
          aria-label="Search friends"
          className="w-full rounded-lg border border-border bg-background px-4 py-3 text-sm"
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search names or handles"
          value={search}
        />
        <div className="max-h-64 space-y-1 overflow-y-auto rounded-lg bg-muted p-2">
          {filteredContacts.length === 0 ? (
            <p className="px-3 py-5 text-center text-sm text-muted-foreground">No eligible friends.</p>
          ) : filteredContacts.map((contact) => {
            const checked = selectedIds.includes(contact.userId)
            const atCapacity = currentMemberCount + selectedIds.length >= 20
            return (
              <label className={`flex items-center gap-3 rounded-xl px-3 py-2.5 ${atCapacity && !checked ? 'cursor-not-allowed opacity-50' : 'cursor-pointer hover:bg-card'}`} key={contact.userId}>
                <Input
                  checked={checked}
                  className="h-4 min-h-0 w-4 accent-primary"
                  disabled={atCapacity && !checked}
                  onChange={(event) => setSelectedIds((current) => event.target.checked
                    ? [...current, contact.userId]
                    : current.filter((id) => id !== contact.userId))}
                  type="checkbox"
                />
                <span className="min-w-0 flex-1 truncate text-sm font-medium">{contact.displayName}</span>
                <code className="truncate text-xs text-muted-foreground">{contact.username}</code>
              </label>
            )
          })}
        </div>
        <p className="text-xs text-muted-foreground">{selectedIds.length} selected · {capacity} spots available</p>
        {error && <p className="rounded-lg bg-destructive/10 px-4 py-3 text-sm text-destructive" role="alert">{error}</p>}
        <Button className="flex w-full items-center justify-center gap-2 rounded-full bg-primary px-4 py-3 font-semibold text-primary-foreground disabled:opacity-60" disabled={busy || selectedIds.length === 0} type="submit">
          {busy ? <LoaderCircle className="animate-spin" size={17} /> : <UserPlus size={17} />}
          Add {selectedIds.length || ''} {selectedIds.length === 1 ? 'member' : 'members'}
        </Button>
      </form>
    </DialogFrame>
  )
}

function SafetyCodesDialog({
  peers,
  loading,
  onClose,
  onCopyCode,
  onTrustPeer
}: {
  peers: PeerIdentity[]
  loading: boolean
  onClose: () => void
  onCopyCode: (peer: PeerIdentity) => Promise<void>
  onTrustPeer: (peer: PeerIdentity) => Promise<void>
}) {
  const closeDialog = useDialogClose(onClose)
  return (
    <DialogFrame onClose={onClose}>
      <header className="flex items-start justify-between gap-4">
        <div>
          <div className="grid h-11 w-11 place-items-center rounded-lg bg-accent text-accent-foreground"><ShieldAlert size={20} /></div>
          <h2 className="mt-3 text-xl font-semibold">Conversation safety codes</h2>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">Comparing a code through a separate trusted channel is optional and can help confirm an identity.</p>
        </div>
        <Button aria-label="Close safety codes" className="rounded-full p-2 text-muted-foreground hover:bg-secondary" onClick={() => closeDialog()} type="button"><X size={18} /></Button>
      </header>
      {loading && peers.length === 0 ? (
        <div className="mt-5 flex items-center gap-2 rounded-lg bg-muted p-4 text-sm text-muted-foreground">
          <LoaderCircle className="animate-spin" size={17} />
          Preparing safety codes…
        </div>
      ) : peers.length === 0 ? (
        <p className="mt-5 rounded-lg bg-muted p-4 text-sm text-muted-foreground">No other identities are in this conversation.</p>
      ) : (
        <div className="mt-5 max-h-[55vh] space-y-3 overflow-y-auto">
          {peers.map((peer) => (
            <section className="rounded-lg border border-border/60 bg-muted/50 p-4" key={peer.userId}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-semibold"><Handle value={peer.username} /></p>
                {peer.status !== 'missing' && peer.status !== 'conflict' && (
                  <div className="flex flex-wrap gap-2">
                    <Button className="rounded-full border border-border px-3 py-2 text-xs font-semibold text-muted-foreground" onClick={() => void onCopyCode(peer)} type="button">Copy code</Button>
                    {peer.status !== 'verified' && (
                      <Button className="rounded-full bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground" onClick={() => void onTrustPeer(peer)} type="button">
                        {peer.status === 'changed' ? 'Verify new code' : 'I compared this code'}
                      </Button>
                    )}
                  </div>
                )}
              </div>
              <code className="mt-3 block break-all text-[11px] leading-5 tracking-wide text-muted-foreground">
                {peer.status === 'missing' ? 'No approved device yet' : peer.fingerprint}
              </code>
              {peer.status === 'verified' && <p className="mt-2 text-xs font-medium text-primary">Key verified on this device</p>}
              {peer.status === 'changed' && <p className="mt-2 text-xs font-medium text-destructive">This code differs from the one saved on this device. Confirm it independently if you want to verify the change.</p>}
              {peer.status === 'conflict' && <p className="mt-2 text-xs font-medium text-destructive">The account's trusted device keys disagree. Do not send until resolved.</p>}
            </section>
          ))}
        </div>
      )}
    </DialogFrame>
  )
}

function ConversationActionsDialog({
  conversation,
  currentUserId,
  nickname,
  onBlock,
  onAddMembers,
  onClear,
  onClose,
  onDeleteForEveryone,
  onHide,
  onRename,
  onViewSafetyCodes
}: {
  conversation: Conversation
  currentUserId: string
  nickname: string
  onBlock: (userId: string) => Promise<void>
  onAddMembers: () => void
  onClear: () => Promise<void>
  onClose: () => void
  onDeleteForEveryone: () => Promise<void>
  onHide: () => Promise<void>
  onRename: () => void
  onViewSafetyCodes?: () => void
}) {
  const closeDialog = useDialogClose(onClose)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const otherMembers = conversation.conversation_members.filter((member) => member.user_id !== currentUserId)

  async function run(action: () => Promise<void>) {
    setBusy(true)
    setError('')
    try {
      await action()
    } catch (reason) {
      setError(messageFromError(reason))
    } finally {
      setBusy(false)
    }
  }

  return (
    <DialogFrame onClose={onClose}>
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="grid h-11 w-11 place-items-center rounded-lg bg-accent text-accent-foreground"><MoreHorizontal size={20} /></div>
          <h2 className="mt-3 text-xl font-semibold">Conversation actions</h2>
          <p className="mt-1 text-sm text-muted-foreground"><ConversationLabel conversation={conversation} currentUserId={currentUserId} nickname={nickname} /></p>
        </div>
        <Button aria-label="Close" className="rounded-full p-2 text-muted-foreground hover:bg-secondary" onClick={() => closeDialog()} type="button"><X size={18} /></Button>
      </div>
      <div className="mt-5 grid gap-2">
        {onViewSafetyCodes && <Button className="flex items-center gap-3 rounded-lg bg-muted px-4 py-3 text-left text-sm font-semibold" disabled={busy} onClick={() => closeDialog(onViewSafetyCodes)} type="button"><ShieldAlert size={17} /> View safety codes</Button>}
        {conversation.kind === 'group' && <Button className="flex items-center gap-3 rounded-lg bg-muted px-4 py-3 text-left text-sm font-semibold" disabled={busy} onClick={() => closeDialog(onAddMembers)} type="button"><UserPlus size={17} /> Add members</Button>}
        <Button className="flex items-center gap-3 rounded-lg bg-muted px-4 py-3 text-left text-sm font-semibold" disabled={busy} onClick={() => closeDialog(onRename)} type="button"><Pencil size={17} /> Rename for me</Button>
        <Button className="flex items-center gap-3 rounded-lg bg-muted px-4 py-3 text-left text-sm font-semibold" disabled={busy} onClick={() => {
          if (window.confirm('Clear your visible history for this conversation? Other participants will keep their messages.')) {
            void run(onClear)
          }
        }} type="button"><Eraser size={17} /> Clear history for me</Button>
        <Button className="flex items-center gap-3 rounded-lg bg-muted px-4 py-3 text-left text-sm font-semibold" disabled={busy} onClick={() => void run(onHide)} type="button"><Archive size={17} /> Remove from my conversations</Button>
      </div>
      <div className="mt-5 border-t border-border/60 pt-4">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Block a user</h3>
        <div className="mt-2 space-y-2">
          {otherMembers.map((member) => {
            const handle = memberUsername(member) ?? 'Sloppy user'
            return (
              <Button className="flex w-full items-center gap-3 rounded-lg border border-destructive/30 px-4 py-3 text-left text-sm font-semibold text-destructive" disabled={busy} key={member.user_id} onClick={() => {
                if (window.confirm(`Block ${handle}? You will lose access to shared conversations and neither of you can send new requests.`)) {
                  void run(() => onBlock(member.user_id))
                }
              }} type="button"><Ban size={17} /> <Handle value={handle} /></Button>
            )
          })}
        </div>
      </div>
      {conversation.kind === 'direct' && (
        <Button className="mt-5 flex w-full items-center gap-3 rounded-lg border border-destructive/40 px-4 py-3 text-left text-sm font-semibold text-destructive" disabled={busy} onClick={() => {
          if (window.confirm('Permanently delete this direct conversation and its encrypted history for both people? This cannot be undone.')) {
            void run(onDeleteForEveryone)
          }
        }} type="button"><Trash2 size={17} /> Delete for both people</Button>
      )}
      {error && <p className="mt-4 rounded-lg bg-destructive/10 px-4 py-3 text-sm text-destructive" role="alert">{error}</p>}
    </DialogFrame>
  )
}

function NicknameDialog({
  conversation,
  currentUserId,
  nickname,
  onClose,
  onSave
}: {
  conversation: Conversation
  currentUserId: string
  nickname: string
  onClose: () => void
  onSave: (nickname: string) => void
}) {
  const closeDialog = useDialogClose(onClose)
  const [value, setValue] = useState(nickname)
  const members = conversationMemberNames(conversation, currentUserId)

  return (
    <DialogFrame onClose={onClose}>
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="grid h-12 w-12 place-items-center rounded-lg bg-accent text-accent-foreground"><Pencil size={20} /></div>
          <h2 className="mt-4 text-xl font-semibold">Conversation nickname</h2>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">
            {conversation.kind === 'group' ? (
              <>
                Group with {members.map((member, index) => (
                  <span key={`${conversation.id}:nickname:${index}`}>
                    {index > 0 && ', '}
                    <Handle value={member} />
                  </span>
                ))}
              </>
            ) : <Handle value={members[0] ?? 'Direct conversation'} />}
          </p>
        </div>
        <Button aria-label="Close" className="rounded-full p-2 text-muted-foreground hover:bg-secondary" onClick={() => closeDialog()} type="button"><X size={18} /></Button>
      </div>
      <form className="mt-6 space-y-4" onSubmit={(event) => {
        event.preventDefault()
        onSave(value.trim())
      }}>
        <label className="block text-sm font-medium">
          Nickname
          <Input
            autoFocus
            className="mt-2 w-full rounded-lg border border-border bg-background px-4 py-3 outline-none focus:border-primary"
            maxLength={40}
            onChange={(event) => setValue(event.target.value)}
            placeholder={conversation.kind === 'group' ? conversation.title || 'Group name' : 'Friend name'}
            value={value}
          />
        </label>
        <p className="text-xs leading-5 text-muted-foreground">
          Nicknames are saved only in this browser. {conversation.kind === 'group'
            ? 'The group name and member display names remain visible beside it.'
            : 'The friend display name remains visible beside it.'}
        </p>
        <div className="flex gap-3">
          {nickname && (
            <Button
              className="flex-1 rounded-full border border-border px-4 py-3 text-sm font-semibold text-muted-foreground hover:bg-muted"
              onClick={() => onSave('')}
              type="button"
            >
              Remove
            </Button>
          )}
          <Button className="flex-1 rounded-full bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground" type="submit">
            Save nickname
          </Button>
        </div>
      </form>
    </DialogFrame>
  )
}

function NewConversationDialog({
  initialHandle,
  acceptedContacts,
  onClose,
  onCreate
}: {
  initialHandle: string
  acceptedContacts: ContactOption[]
  onClose: () => void
  onCreate: (usernames: string[], title: string, firstMessage: string) => Promise<void>
}) {
  const closeDialog = useDialogClose(onClose)
  const [mode, setMode] = useState<'direct' | 'group'>('direct')
  const [handles, setHandles] = useState(initialHandle)
  const [title, setTitle] = useState('')
  const [firstMessage, setFirstMessage] = useState('')
  const [contactSearch, setContactSearch] = useState('')
  const [selectedContactIds, setSelectedContactIds] = useState<string[]>([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const usernames = mode === 'group'
    ? acceptedContacts.filter((contact) => selectedContactIds.includes(contact.userId)).map((contact) => contact.username)
    : handles.split(',').map((handle) => handle.trim().toLowerCase()).filter(Boolean)
  const isDirectRequest = mode === 'direct' && usernames.length === 1
  const isExistingConversation = isDirectRequest && acceptedContacts.some((contact) => contact.username === usernames[0])
  const filteredContacts = acceptedContacts.filter((contact) => (
    `${contact.displayName} ${contact.username}`.toLowerCase().includes(contactSearch.trim().toLowerCase())
  ))
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    const names = mode === 'group'
      ? acceptedContacts.filter((contact) => selectedContactIds.includes(contact.userId)).map((contact) => contact.username)
      : handles.split(',').map((handle) => handle.trim().toLowerCase()).filter(Boolean)
    if (mode === 'group' && names.length < 2) {
      setError('Choose at least two friends for a group.')
      return
    }
    if (names.length === 0) {
      setError('Enter at least one Sloppy username.')
      return
    }
    if (names.some((name) => !isValidUsername(name))) {
      setError('Every username must be 12 characters.')
      return
    }
    if (mode === 'direct' && names.length !== 1) {
      setError('Enter one handle for a direct conversation.')
      return
    }
    if (names.length === 1 && !firstMessage.trim()) {
      setError('Write a first message to send with your request.')
      return
    }
    setBusy(true)
    try {
      await onCreate(names, title, firstMessage.trim())
      closeDialog()
    } catch (reason) {
      setError(messageFromError(reason))
    } finally {
      setBusy(false)
    }
  }
  return (
    <DialogFrame onClose={onClose}>
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="grid h-12 w-12 place-items-center rounded-lg bg-accent text-accent-foreground"><MessageCircle size={21} /></div>
          <h2 className="mt-4 text-xl font-semibold">New conversation</h2>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">
            {isExistingConversation
              ? 'Send a message in your existing encrypted conversation.'
              : isDirectRequest
                ? 'A new one-to-one conversation starts with a message request that the other person can accept or decline.'
                : 'Start a group with people who already have a direct conversation with you.'}
          </p>
        </div>
        <Button aria-label="Close" className="rounded-full p-2 text-muted-foreground hover:bg-secondary" onClick={() => closeDialog()} type="button"><X size={18} /></Button>
      </div>
      <form className="mt-6 space-y-4" onSubmit={submit}>
        <div aria-label="Conversation type" className="grid grid-cols-2 rounded-lg bg-muted p-1" role="group">
          <Button aria-pressed={mode === 'direct'} className={`rounded-xl px-4 py-2.5 text-sm font-semibold ${mode === 'direct' ? 'bg-card text-card-foreground shadow-sm' : 'text-muted-foreground'}`} onClick={() => setMode('direct')} type="button">Direct</Button>
          <Button aria-pressed={mode === 'group'} className={`rounded-xl px-4 py-2.5 text-sm font-semibold ${mode === 'group' ? 'bg-card text-card-foreground shadow-sm' : 'text-muted-foreground'}`} onClick={() => setMode('group')} type="button">Group</Button>
        </div>
        {mode === 'direct' ? (
          <>
            <label className="block text-sm font-medium">
              Sloppy handle
              <Input
                autoFocus
                className="mt-2 w-full rounded-lg border border-border bg-background px-4 py-3 outline-none focus:border-primary"
                onChange={(event) => setHandles(event.target.value)}
                placeholder="Enter a handle"
                required
                value={handles}
              />
            </label>
            {isDirectRequest && (
              <label className="block text-sm font-medium">
                {isExistingConversation ? 'Message' : 'First message'}
                <Textarea
                  className="mt-2 min-h-28 w-full resize-y rounded-lg border border-border bg-background px-4 py-3 outline-none focus:border-primary"
                  maxLength={4000}
                  onChange={(event) => setFirstMessage(event.target.value)}
                  placeholder={isExistingConversation ? 'Write an encrypted message' : 'Write a short introduction'}
                  required
                  value={firstMessage}
                />
              </label>
            )}
          </>
        ) : (
          <>
            <label className="block text-sm font-medium">
              Find friends
              <Input
                autoComplete="off"
                className="mt-2 w-full rounded-lg border border-border bg-background px-4 py-3 outline-none focus:border-primary"
                onChange={(event) => setContactSearch(event.target.value)}
                placeholder="Search names or handles"
                value={contactSearch}
              />
            </label>
            <div className="max-h-56 space-y-1 overflow-y-auto rounded-lg bg-muted p-2">
              {filteredContacts.length === 0 ? (
                <p className="px-3 py-4 text-center text-sm text-muted-foreground">No friends found.</p>
              ) : filteredContacts.map((contact) => (
                <label className="flex cursor-pointer items-center gap-3 rounded-xl px-3 py-2.5 hover:bg-card" key={contact.userId}>
                  <Input
                    checked={selectedContactIds.includes(contact.userId)}
                    className="h-4 min-h-0 w-4 accent-primary"
                    onChange={(event) => setSelectedContactIds((current) => event.target.checked
                      ? [...current, contact.userId]
                      : current.filter((id) => id !== contact.userId))}
                    type="checkbox"
                  />
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">{contact.displayName}</span>
                  <code className="truncate text-xs text-muted-foreground">{contact.username}</code>
                </label>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">{selectedContactIds.length} selected · Select at least 2. Friends must already have accepted a direct request.</p>
            <label className="block text-sm font-medium">
              Group name <span className="font-normal text-muted-foreground">(optional)</span>
              <Input
                className="mt-2 w-full rounded-lg border border-border bg-background px-4 py-3 outline-none focus:border-primary"
                maxLength={80}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="Name this group"
                value={title}
              />
            </label>
          </>
        )}
        {error && <p className="rounded-lg bg-destructive/10 px-4 py-3 text-sm text-destructive" role="alert">{error}</p>}
        <Button className="flex w-full items-center justify-center gap-2 rounded-full bg-primary px-5 py-3.5 font-semibold text-primary-foreground disabled:opacity-60" disabled={busy} type="submit">
          {busy ? <LoaderCircle className="animate-spin" size={18} /> : <Plus size={18} />}
          {mode === 'group' ? 'Create group' : isExistingConversation ? 'Send message' : 'Send message request'}
        </Button>
      </form>
    </DialogFrame>
  )
}

function DeviceDialog({
  busyDeviceId,
  currentDeviceId,
  onApprove,
  onClose,
  onRevoke,
  onRefresh,
  pendingDevices,
  trustedDevices
}: {
  busyDeviceId: string
  currentDeviceId: string
  onApprove: (device: StoredDevice) => Promise<void>
  onClose: () => void
  onRevoke: (device: StoredDevice) => Promise<void>
  onRefresh: () => Promise<void>
  pendingDevices: StoredDevice[]
  trustedDevices: StoredDevice[]
}) {
  const closeDialog = useDialogClose(onClose)
  const [refreshing, setRefreshing] = useState(false)
  const [refreshError, setRefreshError] = useState('')
  const [approvalError, setApprovalError] = useState('')
  async function refresh() {
    setRefreshing(true)
    setRefreshError('')
    try {
      await onRefresh()
    } catch (reason) {
      setRefreshError(messageFromError(reason))
    } finally {
      setRefreshing(false)
    }
  }
  return (
    <DialogFrame onClose={onClose}>
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="grid h-12 w-12 place-items-center rounded-lg bg-muted text-foreground"><Smartphone size={21} /></div>
          <h2 className="mt-4 text-xl font-semibold">Trusted devices</h2>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">Compare each request code with the new browser before approving. It will not receive earlier messages.</p>
        </div>
        <Button aria-label="Close" className="rounded-full p-2 text-muted-foreground hover:bg-secondary" onClick={() => closeDialog()} type="button"><X size={18} /></Button>
      </div>
      <div className="mt-6 space-y-3">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Approved browsers</h3>
        {trustedDevices.map((device) => (
          <div className="flex items-center gap-3 rounded-lg border border-border/70 p-4" key={device.device_id}>
            <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-accent text-accent-foreground"><ShieldCheck size={18} /></div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold">{device.label}{device.device_id === currentDeviceId ? ' · This browser' : ''}</p>
              <p className="truncate text-xs text-muted-foreground">{device.device_id}</p>
            </div>
            {device.device_id !== currentDeviceId && (
              <Button
                className="rounded-full border border-border px-3 py-2 text-xs font-semibold text-destructive disabled:opacity-50"
                disabled={busyDeviceId === device.device_id}
                onClick={() => {
                  setApprovalError('')
                  void onRevoke(device).catch((reason: unknown) => setApprovalError(messageFromError(reason)))
                }}
                type="button"
              >
                Revoke
              </Button>
            )}
          </div>
        ))}
        <h3 className="pt-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Pending requests</h3>
        {pendingDevices.length === 0 ? (
          <div className="rounded-lg bg-muted p-4 text-sm text-muted-foreground">No pending device requests.</div>
        ) : pendingDevices.map((device) => (
          <div className="flex items-center gap-3 rounded-lg border border-border/70 p-4" key={device.device_id}>
            <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-secondary text-primary"><Smartphone size={18} /></div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold">{device.label}</p>
              <p className="truncate text-xs text-muted-foreground">Code: {device.device_id}</p>
            </div>
            <Button
              className="rounded-full bg-accent px-3 py-2 text-xs font-semibold text-accent-foreground disabled:opacity-50"
              disabled={busyDeviceId === device.device_id}
              onClick={() => {
                setApprovalError('')
                void onApprove(device).catch((reason: unknown) => setApprovalError(messageFromError(reason)))
              }}
              type="button"
            >
              {busyDeviceId === device.device_id ? 'Approving' : 'Approve'}
            </Button>
          </div>
        ))}
      </div>
      {approvalError && <p className="mt-4 rounded-lg bg-destructive/10 px-4 py-3 text-sm text-destructive" role="alert">{approvalError}</p>}
      {refreshError && <p className="mt-4 rounded-lg bg-destructive/10 px-4 py-3 text-sm text-destructive" role="alert">{refreshError}</p>}
      <Button className="mt-5 flex w-full items-center justify-center gap-2 rounded-full border border-border px-5 py-3 text-sm font-semibold hover:bg-muted disabled:opacity-60" disabled={refreshing} onClick={() => void refresh()} type="button">
        {refreshing ? <LoaderCircle className="animate-spin" size={17} /> : <ShieldCheck size={17} />}
        Refresh requests
      </Button>
    </DialogFrame>
  )
}

function DialogFrame({ children, onClose }: { children: ReactNode; onClose: () => void }) {
  const [open, setOpen] = useState(true)
  const closeTimer = useRef<number | null>(null)
  const isClosing = useRef(false)
  const requestClose = useCallback((afterClose?: () => void) => {
    if (isClosing.current) return
    isClosing.current = true
    setOpen(false)
    const delay = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 210
    closeTimer.current = window.setTimeout(() => {
      onClose()
      afterClose?.()
    }, delay)
  }, [onClose])

  useEffect(() => () => {
    if (closeTimer.current !== null) window.clearTimeout(closeTimer.current)
  }, [])

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => { if (!nextOpen) requestClose() }}>
      <DialogCloseContext.Provider value={requestClose}>
        <DialogContent
          aria-label="Sloppy Chat dialog"
          className="dialog-panel max-h-[90vh] w-full max-w-lg overflow-y-auto p-6 sm:max-w-lg sm:p-8"
          showCloseButton={false}
        >
          {children}
        </DialogContent>
      </DialogCloseContext.Provider>
    </Dialog>
  )
}

function ProblemScreen({ error, onSignOut }: { error: string; onSignOut: () => void }) {
  return (
    <main className="grid min-h-screen place-items-center bg-background px-5 py-10">
      <section className="w-full max-w-lg rounded-xl bg-card p-8 shadow-lift">
        <BrandMark />
        <div className="mt-8 grid h-14 w-14 place-items-center rounded-lg bg-destructive/10 text-destructive"><ShieldAlert size={25} /></div>
        <h1 className="mt-5 text-2xl font-semibold">Could not open your workspace</h1>
        <p className="mt-3 leading-7 text-muted-foreground">{error}</p>
        <Button className="mt-6 flex items-center gap-2 rounded-full bg-secondary px-5 py-3 text-sm font-semibold" onClick={onSignOut} type="button">
          <LogOut size={17} />
          Sign out
        </Button>
      </section>
    </main>
  )
}

export default App
