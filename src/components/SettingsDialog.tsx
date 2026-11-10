import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { Check, KeyRound, LoaderCircle, Monitor, Moon, Shield, Sun, UserRound, X } from 'lucide-react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { authEmailForUsername, validatePassword } from '../lib/auth'
import { loadBlockedUsers, unblockUser, type BlockedUser } from '../lib/conversation-service'
import { Handle } from './Handle'
import { Alert, AlertDescription } from './ui/alert'
import { Button } from './ui/button'
import { Dialog, DialogContent } from './ui/dialog'
import { Input } from './ui/input'
import { accentColorPresets, accentForeground, type AccentColor } from '../lib/appearance'

type Theme = 'system' | 'light' | 'dark'
type SettingsSection = 'appearance' | 'profile' | 'security' | 'privacy'

export function SettingsDialog({
  client,
  notificationsEnabled,
  onClose,
  onNotificationsChange,
  onOpenDevices,
  onOpenRequests,
  onThemeChange,
  accentColor,
  onAccentColorChange,
  onDisplayNameChange,
  theme,
  displayName,
  username
}: {
  client: SupabaseClient
  notificationsEnabled: boolean
  onClose: () => void
  onNotificationsChange: (enabled: boolean) => void
  onOpenDevices: () => void
  onOpenRequests: () => void
  onThemeChange: (theme: Theme) => void
  accentColor: string
  onAccentColorChange: (color: AccentColor) => void
  onDisplayNameChange: (displayName: string) => void
  theme: Theme
  displayName: string
  username: string
}) {
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
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [activeSection, setActiveSection] = useState<SettingsSection>('appearance')
  const [displayNameDraft, setDisplayNameDraft] = useState(displayName)
  const [blockedUsers, setBlockedUsers] = useState<BlockedUser[]>([])
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  useEffect(() => () => {
    if (closeTimer.current !== null) window.clearTimeout(closeTimer.current)
  }, [])

  useEffect(() => {
    let active = true
    void loadBlockedUsers(client)
      .then((users) => { if (active) setBlockedUsers(users) })
      .catch((reason: unknown) => {
        if (active) setError(reason instanceof Error ? reason.message : 'Could not load blocked users.')
      })
    return () => { active = false }
  }, [client])

  async function saveDisplayName(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const nextName = displayNameDraft.trim()
    if (!nextName || nextName.length > 40) {
      setError('Use a display name between 1 and 40 characters.')
      return
    }
    setError('')
    setNotice('')
    setBusy('display-name')
    try {
      const { error: updateError } = await client.rpc('set_my_display_name', {
        requested_display_name: nextName
      })
      if (updateError) throw new Error(updateError.message)
      setDisplayNameDraft(nextName)
      onDisplayNameChange(nextName)
      setNotice('Display name updated.')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not update your display name.')
    } finally {
      setBusy('')
    }
  }

  async function changePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setNotice('')
    if (newPassword !== confirmPassword) {
      setError('Your new passwords do not match.')
      return
    }
    const passwordError = validatePassword(newPassword)
    if (passwordError) {
      setError(passwordError)
      return
    }
    setBusy('password')
    try {
      const { error: reauthError } = await client.auth.signInWithPassword({
        email: authEmailForUsername(username),
        password: currentPassword
      })
      if (reauthError) throw new Error('The current password is incorrect.')
      const { error: updateError } = await client.auth.updateUser({ password: newPassword })
      if (updateError) throw new Error(updateError.message)
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
      setNotice('Password updated.')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not update your password.')
    } finally {
      setBusy('')
    }
  }

  async function removeBlock(user: BlockedUser) {
    setError('')
    setBusy(user.user_id)
    try {
      await unblockUser(client, user.user_id)
      setBlockedUsers((current) => current.filter((entry) => entry.user_id !== user.user_id))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not unblock this user.')
    } finally {
      setBusy('')
    }
  }

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => { if (!nextOpen) requestClose() }}>
      <DialogContent
        aria-labelledby="settings-title"
        className="settings-dialog-panel flex h-[min(44rem,92vh)] max-w-3xl flex-col overflow-hidden p-5 sm:p-7"
        showCloseButton={false}
      >
        <header className="flex items-start justify-between gap-4">
          <div>
            <div className="grid h-11 w-11 place-items-center rounded-lg bg-accent text-accent-foreground"><Shield size={20} /></div>
            <h2 className="mt-3 text-xl font-semibold" id="settings-title">Settings</h2>
            <p className="mt-1 text-sm text-muted-foreground">Account, privacy, and appearance</p>
          </div>
          <Button aria-label="Close settings" className="grid h-10 w-10 place-items-center rounded-full text-muted-foreground hover:bg-secondary" onClick={() => requestClose()} type="button"><X size={18} /></Button>
        </header>

        <div className="mt-6 grid min-h-0 flex-1 gap-4 sm:grid-cols-[10rem_minmax(0,1fr)]">
          <nav aria-label="Settings categories" className="grid grid-cols-2 gap-2 sm:flex sm:flex-col">
            {([
              ['appearance', 'Appearance', Sun],
              ['profile', 'Display Name', UserRound],
              ['security', 'Security', KeyRound],
              ['privacy', 'Privacy & access', Shield]
            ] as const).map(([section, label, Icon]) => (
              <Button
                aria-current={activeSection === section ? 'page' : undefined}
                className={`flex min-w-0 items-center justify-start gap-2 rounded-lg px-3 py-2.5 text-sm font-semibold sm:w-full ${activeSection === section ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:bg-muted'}`}
                key={section}
                onClick={() => {
                  setActiveSection(section)
                  setError('')
                  setNotice('')
                }}
                type="button"
              >
                <Icon size={16} />
                {label}
              </Button>
            ))}
          </nav>

          <div
            aria-labelledby={`settings-heading-${activeSection}`}
            className="min-h-0 overflow-y-auto rounded-xl border border-border/60 bg-background p-4 sm:p-5"
          >
            {activeSection === 'appearance' && (
              <section>
                <h3 className="text-base font-semibold" id="settings-heading-appearance">Appearance</h3>
                <p className="mt-1 text-sm text-muted-foreground">Choose a theme and accent color for the interface.</p>
                <div aria-label="Color theme" className="mt-4 grid grid-cols-3 gap-2" role="group">
                  <Button aria-pressed={theme === 'system'} className={`flex items-center justify-center gap-2 rounded-lg border px-2 py-3 text-sm font-semibold ${theme === 'system' ? 'border-primary bg-accent text-accent-foreground' : 'border-border text-muted-foreground'}`} onClick={() => onThemeChange('system')} type="button" variant="outline"><Monitor size={16} /> System</Button>
                  <Button aria-pressed={theme === 'light'} className={`flex items-center justify-center gap-2 rounded-lg border px-2 py-3 text-sm font-semibold ${theme === 'light' ? 'border-primary bg-accent text-accent-foreground' : 'border-border text-muted-foreground'}`} onClick={() => onThemeChange('light')} type="button" variant="outline"><Sun size={16} /> Light</Button>
                  <Button aria-pressed={theme === 'dark'} className={`flex items-center justify-center gap-2 rounded-lg border px-2 py-3 text-sm font-semibold ${theme === 'dark' ? 'border-primary bg-accent text-accent-foreground' : 'border-border text-muted-foreground'}`} onClick={() => onThemeChange('dark')} type="button" variant="outline"><Moon size={16} /> Dark</Button>
                </div>
                <div className="mt-4 rounded-lg bg-muted p-3">
                  <p className="text-sm font-medium">Accent color</p>
                  <p className="mt-1 text-xs text-muted-foreground">Choose a color for your interface and logo.</p>
                  <div aria-label="Accent color" className="mt-3 flex flex-wrap gap-2" role="radiogroup">
                    {accentColorPresets.map((preset) => (
                      <Button
                        aria-checked={accentColor === preset.value}
                        aria-label={preset.name}
                        className={`flex items-center gap-2 rounded-full border px-3 py-2 text-xs font-semibold ${accentColor === preset.value ? 'border-primary bg-background text-foreground' : 'border-border bg-background text-muted-foreground'}`}
                        key={preset.value}
                        onClick={() => onAccentColorChange(preset.value)}
                        role="radio"
                        title={preset.name}
                        type="button"
                        variant="outline"
                      >
                        <span className="grid h-4 w-4 place-items-center rounded-full" style={{ backgroundColor: preset.value }}>
                          {accentColor === preset.value && <Check aria-hidden="true" color={accentForeground(preset.value)} size={12} strokeWidth={3} />}
                        </span>
                        {preset.name}
                      </Button>
                    ))}
                  </div>
                </div>
              </section>
            )}

            {activeSection === 'profile' && (
              <section>
                <h3 className="text-base font-semibold" id="settings-heading-profile">Display Name</h3>
                <p className="mt-1 text-sm text-muted-foreground">This is the name your friends see. Your generated handle stays your login and friend link.</p>
                <form className="mt-4 flex flex-col gap-2 sm:flex-row" onSubmit={(event) => void saveDisplayName(event)}>
                  <Input autoComplete="name" aria-label="Display Name" className="min-w-0 flex-1 rounded-lg border border-border bg-background px-4 py-3 text-sm" maxLength={40} onChange={(event) => setDisplayNameDraft(event.target.value)} value={displayNameDraft} />
                  <Button className="flex items-center justify-center gap-2 rounded-full bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground disabled:opacity-60" disabled={busy === 'display-name'} type="submit">{busy === 'display-name' ? <LoaderCircle className="animate-spin" size={16} /> : <Check size={16} />} Save name</Button>
                </form>
              </section>
            )}

            {activeSection === 'security' && (
              <section>
                <h3 className="text-base font-semibold" id="settings-heading-security">Password</h3>
                <p className="mt-1 text-sm text-muted-foreground">Update the password used to unlock your account.</p>
                <form className="mt-4 grid gap-3 sm:grid-cols-2" onSubmit={(event) => void changePassword(event)}>
                  <label className="text-sm font-medium sm:col-span-2">Current password<Input autoComplete="current-password" className="mt-2 w-full rounded-lg border border-border bg-background px-4 py-3" onChange={(event) => setCurrentPassword(event.target.value)} required type="password" value={currentPassword} /></label>
                  <label className="text-sm font-medium">New password<Input autoComplete="new-password" className="mt-2 w-full rounded-lg border border-border bg-background px-4 py-3" maxLength={72} onChange={(event) => setNewPassword(event.target.value)} required type="password" value={newPassword} /></label>
                  <label className="text-sm font-medium">Confirm new password<Input autoComplete="new-password" className="mt-2 w-full rounded-lg border border-border bg-background px-4 py-3" maxLength={72} onChange={(event) => setConfirmPassword(event.target.value)} required type="password" value={confirmPassword} /></label>
                  <Button className="flex items-center justify-center gap-2 rounded-full bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground disabled:opacity-60 sm:col-span-2" disabled={busy === 'password'} type="submit">{busy === 'password' ? <LoaderCircle className="animate-spin" size={16} /> : <Check size={16} />} Update password</Button>
                </form>
              </section>
            )}

            {activeSection === 'privacy' && (
              <div className="space-y-6">
                <section>
                  <h3 className="text-base font-semibold" id="settings-heading-privacy">Notifications</h3>
                  <label className="mt-3 flex cursor-pointer items-start gap-3 rounded-lg bg-muted p-4">
                    <Input checked={notificationsEnabled} className="mt-1 h-4 min-h-0 w-4 accent-primary" onChange={(event) => onNotificationsChange(event.target.checked)} type="checkbox" />
                    <span><span className="block text-sm font-medium">Notifications</span><span className="mt-1 block text-xs leading-5 text-muted-foreground">Popups and background-tab browser alerts. Message text is never shown.</span></span>
                  </label>
                </section>

                <section className="border-t border-border/60 pt-5">
                  <h3 className="text-sm font-semibold">Approvals and access</h3>
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <Button className="rounded-lg bg-muted px-3 py-3 text-sm font-semibold" onClick={() => requestClose(onOpenRequests)} type="button">Message requests</Button>
                    <Button className="rounded-lg bg-muted px-3 py-3 text-sm font-semibold" onClick={() => requestClose(onOpenDevices)} type="button">Trusted devices</Button>
                  </div>
                </section>

                <section className="border-t border-border/60 pt-5">
                  <h3 className="text-sm font-semibold">Blocked users</h3>
                  {blockedUsers.length === 0 ? <p className="mt-2 text-sm text-muted-foreground">No blocked users.</p> : <ul className="mt-2 space-y-2">{blockedUsers.map((user) => <li className="flex items-center gap-3 rounded-lg bg-muted px-4 py-3" key={user.user_id}><span className="min-w-0 flex-1 truncate text-sm"><Handle value={user.username} /></span><Button className="text-xs font-semibold text-primary" disabled={Boolean(busy)} onClick={() => void removeBlock(user)} type="button">{busy === user.user_id ? 'Unblocking' : 'Unblock'}</Button></li>)}</ul>}
                </section>
              </div>
            )}

            {(error || notice) && (
              <Alert
                className={error ? 'mt-4' : 'mt-4 border-primary/30 bg-primary/10 text-primary'}
                role={error ? 'alert' : 'status'}
                variant={error ? 'destructive' : 'default'}
              >
                <AlertDescription className={error ? 'text-destructive' : 'text-primary'}>
                  {error || notice}
                </AlertDescription>
              </Alert>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
