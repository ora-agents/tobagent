'use client'

import { useState, useEffect } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useAuth } from '@/components/providers/auth-provider'
import { User, Lock, Mail, AlertCircle, Loader2 } from 'lucide-react'
import { useT } from '@/lib/i18n'

interface AuthDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function AuthDialog({ open, onOpenChange }: AuthDialogProps) {
  const t = useT()
  const { login, register, error, clearError } = useAuth()
  
  const [activeTab, setActiveTab] = useState<'login' | 'register'>('login')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [localError, setLocalError] = useState<string | null>(null)

  // Clear errors when switching tabs or opening/closing dialog
  useEffect(() => {
    clearError()
    setLocalError(null)
  }, [activeTab, open, clearError])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLocalError(null)

    if (!username.trim() || !password) {
      setLocalError('Please fill in all required fields.')
      return
    }

    if (activeTab === 'register') {
      if (password !== confirmPassword) {
        setLocalError('Passwords do not match.')
        return
      }
      if (password.length < 6) {
        setLocalError('Password must be at least 6 characters.')
        return
      }
    }

    setLoading(true)
    try {
      if (activeTab === 'login') {
        await login(username.trim(), password)
      } else {
        await register(username.trim(), password, email.trim() || undefined)
      }
      onOpenChange(false) // Close dialog on success
      // Reset form
      setUsername('')
      setPassword('')
      setConfirmPassword('')
      setEmail('')
    } catch (err: any) {
      // Error is already set in the AuthProvider state
    } finally {
      setLoading(false)
    }
  }

  const shownError = localError || error

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md bg-background/95 backdrop-blur-md border-border/60 shadow-depth-lg rounded-xl overflow-hidden p-0">
        {/* Colorful gradient header decoration */}
        <div className="h-2 w-full bg-gradient-to-r from-primary via-primary/80 to-primary/40" />
        
        <div className="p-6 space-y-6">
          <DialogHeader className="text-left space-y-1">
            <DialogTitle className="text-2xl font-bold font-sans tracking-tight text-foreground">
              {activeTab === 'login' ? 'Welcome Back' : 'Create Account'}
            </DialogTitle>
            <DialogDescription className="text-muted-foreground text-sm">
              {activeTab === 'login' 
                ? 'Sign in to access your saved chat history and preferences' 
                : 'Join us to customize your AI agents and save conversation history'}
            </DialogDescription>
          </DialogHeader>

          {/* Custom Modern Tabs */}
          <div className="flex border-b border-border/40 pb-px">
            <button
              onClick={() => setActiveTab('login')}
              className={`flex-1 pb-3 text-sm font-semibold transition-all duration-200 border-b-2 text-center focus:outline-none ${
                activeTab === 'login'
                  ? 'border-primary text-primary'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              Sign In
            </button>
            <button
              onClick={() => setActiveTab('register')}
              className={`flex-1 pb-3 text-sm font-semibold transition-all duration-200 border-b-2 text-center focus:outline-none ${
                activeTab === 'register'
                  ? 'border-primary text-primary'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              Register
            </button>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Error Message */}
            {shownError && (
              <div className="flex items-center gap-2.5 p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-sm animate-shake">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <div className="font-medium truncate">{shownError}</div>
              </div>
            )}

            {/* Username Input */}
            <div className="space-y-1.5">
              <Label htmlFor="username" className="text-xs font-semibold text-muted-foreground">
                Username <span className="text-destructive">*</span>
              </Label>
              <div className="relative group">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 z-10 text-muted-foreground/75 group-focus-within:text-primary transition-all duration-200">
                  <User className="w-4 h-4" />
                </span>
                <Input
                  id="username"
                  type="text"
                  placeholder="Enter username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  disabled={loading}
                  className="pl-9 bg-background/50 border-border/40 focus:border-primary/60 focus:bg-background/90 focus:ring-0 rounded-lg h-10 text-sm font-sans"
                  required
                />
              </div>
            </div>

            {/* Email Input (only for register) */}
            {activeTab === 'register' && (
              <div className="space-y-1.5 animate-fadeIn">
                <Label htmlFor="email" className="text-xs font-semibold text-muted-foreground">
                  Email
                </Label>
                <div className="relative group">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 z-10 text-muted-foreground/75 group-focus-within:text-primary transition-all duration-200">
                    <Mail className="w-4 h-4" />
                  </span>
                  <Input
                    id="email"
                    type="email"
                    placeholder="Enter email (optional)"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    disabled={loading}
                    className="pl-9 bg-background/50 border-border/40 focus:border-primary/60 focus:bg-background/90 focus:ring-0 rounded-lg h-10 text-sm font-sans"
                  />
                </div>
              </div>
            )}

            {/* Password Input */}
            <div className="space-y-1.5">
              <Label htmlFor="password" className="text-xs font-semibold text-muted-foreground">
                Password <span className="text-destructive">*</span>
              </Label>
              <div className="relative group">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 z-10 text-muted-foreground/75 group-focus-within:text-primary transition-all duration-200">
                  <Lock className="w-4 h-4" />
                </span>
                <Input
                  id="password"
                  type="password"
                  placeholder="Enter password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={loading}
                  className="pl-9 bg-background/50 border-border/40 focus:border-primary/60 focus:bg-background/90 focus:ring-0 rounded-lg h-10 text-sm font-sans"
                  required
                />
              </div>
            </div>

            {/* Confirm Password (only for register) */}
            {activeTab === 'register' && (
              <div className="space-y-1.5 animate-fadeIn">
                <Label htmlFor="confirmPassword" className="text-xs font-semibold text-muted-foreground">
                  Confirm Password <span className="text-destructive">*</span>
                </Label>
                <div className="relative group">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 z-10 text-muted-foreground/75 group-focus-within:text-primary transition-all duration-200">
                    <Lock className="w-4 h-4" />
                  </span>
                  <Input
                    id="confirmPassword"
                    type="password"
                    placeholder="Confirm password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    disabled={loading}
                    className="pl-9 bg-background/50 border-border/40 focus:border-primary/60 focus:bg-background/90 focus:ring-0 rounded-lg h-10 text-sm font-sans"
                    required
                  />
                </div>
              </div>
            )}

            {/* Submit Button */}
            <Button
              type="submit"
              disabled={loading}
              className="w-full mt-2 h-10 text-sm font-semibold rounded-lg bg-primary hover:bg-primary/95 hover:shadow-depth-hover transition-all duration-200"
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin mr-2" />
                  Please wait...
                </>
              ) : activeTab === 'login' ? (
                'Sign In'
              ) : (
                'Create Account'
              )}
            </Button>
          </form>

          {/* Bottom Switch text */}
          <div className="text-center text-xs text-muted-foreground">
            {activeTab === 'login' ? (
              <>
                Don't have an account?{' '}
                <button
                  type="button"
                  onClick={() => setActiveTab('register')}
                  className="font-bold text-primary hover:underline hover:text-primary/90"
                >
                  Create one now
                </button>
              </>
            ) : (
              <>
                Already have an account?{' '}
                <button
                  type="button"
                  onClick={() => setActiveTab('login')}
                  className="font-bold text-primary hover:underline hover:text-primary/90"
                >
                  Sign in here
                </button>
              </>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
