import { useEffect, useState, type FormEvent } from 'react'
import { Bell, Check, KeyRound, LoaderCircle, Monitor, Moon, Shield, Sun, X } from 'lucide-react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { authEmailForUsername, validatePassword } from '../lib/auth'
import { loadBlockedUsers, unblockUser, type BlockedUser } from '../lib/conversation-service'
import { Handle } from './Handle'

type Theme = 'system' | 'light' | 'dark'

export function SettingsDialog({
  client,
  notificationsEnabled,
  onClose,
  onNotificationsChange,
  onOpenDevices,
  onOpenRequests,
  onThemeChange,
  theme,
  username
}: {
  client: SupabaseClient
  notificationsEnabled: boolean
  onClose: () => void
  onNotificationsChange: (enabled: boolean) => void
  onOpenDevices: () => void
  onOpenRequests: () => void
  onThemeChange: (theme: Theme) => void
  theme: Theme
  username: string
}) {
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [blockedUsers, setBlockedUsers] = useState<BlockedUser[]>([])
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  useEffect(() => {
    let active = true
    void loadBlockedUsers(client)
      .then((users) => { if (active) setBlockedUsers(users) })
      .catch((reason: unknown) => {
        if (active) setError(reason instanceof Error ? reason.message : 'Could not load blocked users.')
      })
    return () => { active = false }
  }, [client])

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
    <div className="dialog-backdrop fixed inset-0 z-50 grid place-items-center bg-md3-onBackground/35 p-4 backdrop-blur-sm" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose()
    }}>
      <section aria-labelledby="settings-title" aria-modal="true" className="dialog-panel settings-dialog-panel max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-3xl bg-md3-surface p-5 shadow-lift sm:p-7" role="dialog">
        <header className="flex items-start justify-between gap-4">
          <div>
            <div className="grid h-11 w-11 place-items-center rounded-2xl bg-md3-primaryContainer text-md3-onPrimaryContainer"><Shield size={20} /></div>
            <h2 className="mt-3 text-xl font-semibold" id="settings-title">Settings</h2>
            <p className="mt-1 text-sm text-md3-onSurfaceVariant">Account, privacy, and appearance</p>
          </div>
          <button aria-label="Close settings" className="grid h-10 w-10 place-items-center rounded-full text-md3-onSurfaceVariant hover:bg-md3-surfaceContainer" onClick={onClose} type="button"><X size={18} /></button>
        </header>

        <section className="mt-6 border-t border-md3-outlineVariant/60 pt-5">
          <h3 className="flex items-center gap-2 text-sm font-semibold"><Sun size={16} /> Appearance</h3>
          <div aria-label="Color theme" className="mt-3 grid grid-cols-3 gap-2" role="group">
            <button aria-pressed={theme === 'system'} className={`flex items-center justify-center gap-2 rounded-2xl border px-2 py-3 text-sm font-semibold ${theme === 'system' ? 'border-md3-primary bg-md3-primaryContainer text-md3-onPrimaryContainer' : 'border-md3-outlineVariant text-md3-onSurfaceVariant'}`} onClick={() => onThemeChange('system')} type="button"><Monitor size={16} /> System</button>
            <button aria-pressed={theme === 'light'} className={`flex items-center justify-center gap-2 rounded-2xl border px-2 py-3 text-sm font-semibold ${theme === 'light' ? 'border-md3-primary bg-md3-primaryContainer text-md3-onPrimaryContainer' : 'border-md3-outlineVariant text-md3-onSurfaceVariant'}`} onClick={() => onThemeChange('light')} type="button"><Sun size={16} /> Light</button>
            <button aria-pressed={theme === 'dark'} className={`flex items-center justify-center gap-2 rounded-2xl border px-2 py-3 text-sm font-semibold ${theme === 'dark' ? 'border-md3-primary bg-md3-primaryContainer text-md3-onPrimaryContainer' : 'border-md3-outlineVariant text-md3-onSurfaceVariant'}`} onClick={() => onThemeChange('dark')} type="button"><Moon size={16} /> Dark</button>
          </div>
        </section>

        <section className="mt-5 border-t border-md3-outlineVariant/60 pt-5">
          <h3 className="flex items-center gap-2 text-sm font-semibold"><Bell size={16} /> Notifications</h3>
          <label className="mt-3 flex cursor-pointer items-start gap-3 rounded-2xl bg-md3-surfaceContainerLow p-4">
            <input checked={notificationsEnabled} className="mt-1 h-4 w-4 accent-[rgb(var(--md3-primary))]" onChange={(event) => onNotificationsChange(event.target.checked)} type="checkbox" />
            <span><span className="block text-sm font-medium">Notifications</span><span className="mt-1 block text-xs leading-5 text-md3-onSurfaceVariant">Popups and background-tab browser alerts. Message text is never shown.</span></span>
          </label>
        </section>

        <section className="mt-5 border-t border-md3-outlineVariant/60 pt-5">
          <h3 className="flex items-center gap-2 text-sm font-semibold"><KeyRound size={16} /> Change password</h3>
          <form className="mt-3 grid gap-3 sm:grid-cols-2" onSubmit={(event) => void changePassword(event)}>
            <label className="text-sm font-medium sm:col-span-2">Current password<input autoComplete="current-password" className="mt-2 w-full rounded-2xl border border-md3-outlineVariant bg-md3-background px-4 py-3" onChange={(event) => setCurrentPassword(event.target.value)} required type="password" value={currentPassword} /></label>
            <label className="text-sm font-medium">New password<input autoComplete="new-password" className="mt-2 w-full rounded-2xl border border-md3-outlineVariant bg-md3-background px-4 py-3" maxLength={72} onChange={(event) => setNewPassword(event.target.value)} required type="password" value={newPassword} /></label>
            <label className="text-sm font-medium">Confirm new password<input autoComplete="new-password" className="mt-2 w-full rounded-2xl border border-md3-outlineVariant bg-md3-background px-4 py-3" maxLength={72} onChange={(event) => setConfirmPassword(event.target.value)} required type="password" value={confirmPassword} /></label>
            <button className="flex items-center justify-center gap-2 rounded-full bg-md3-primary px-4 py-3 text-sm font-semibold text-md3-onPrimary disabled:opacity-60 sm:col-span-2" disabled={busy === 'password'} type="submit">{busy === 'password' ? <LoaderCircle className="animate-spin" size={16} /> : <Check size={16} />} Update password</button>
          </form>
        </section>

        <section className="mt-5 border-t border-md3-outlineVariant/60 pt-5">
          <h3 className="text-sm font-semibold">Approvals and access</h3>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <button className="rounded-2xl bg-md3-surfaceContainerLow px-3 py-3 text-sm font-semibold" onClick={onOpenRequests} type="button">Message requests</button>
            <button className="rounded-2xl bg-md3-surfaceContainerLow px-3 py-3 text-sm font-semibold" onClick={onOpenDevices} type="button">Trusted devices</button>
          </div>
        </section>

        <section className="mt-5 border-t border-md3-outlineVariant/60 pt-5">
          <h3 className="text-sm font-semibold">Blocked users</h3>
          {blockedUsers.length === 0 ? <p className="mt-2 text-sm text-md3-onSurfaceVariant">No blocked users.</p> : <ul className="mt-2 space-y-2">{blockedUsers.map((user) => <li className="flex items-center gap-3 rounded-2xl bg-md3-surfaceContainerLow px-4 py-3" key={user.user_id}><span className="min-w-0 flex-1 truncate text-sm"><Handle value={user.username} /></span><button className="text-xs font-semibold text-md3-primary" disabled={Boolean(busy)} onClick={() => void removeBlock(user)} type="button">{busy === user.user_id ? 'Unblocking' : 'Unblock'}</button></li>)}</ul>}
        </section>
        {(error || notice) && <p className={`mt-4 rounded-2xl px-4 py-3 text-sm ${error ? 'bg-md3-errorContainer text-md3-onErrorContainer' : 'bg-md3-primaryContainer text-md3-onPrimaryContainer'}`} role={error ? 'alert' : 'status'}>{error || notice}</p>}
      </section>
    </div>
  )
}
