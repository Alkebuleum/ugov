import { useCallback } from 'react'
import { useAuth } from './auth'
import { useToast } from '../components/Toast'

/**
 * Wrap any action that requires a session.
 * If not logged in, shows a snackbar with a "Connect" button and returns early.
 * If logged in, runs the action.
 */
export function useGuardedAction() {
    const { session, signin } = useAuth()
    const { show } = useToast()

    return useCallback(
        (actionLabel: string, fn: () => void | Promise<void>) => {
            if (!session) {
                show({
                    title: `Login required`,
                    desc: `You must connect AmVault to ${actionLabel}.`,
                    action: { label: 'Connect AmVault', onClick: () => signin() },
                    duration: 6000,
                })
                return
            }
            // Execute user action (supports async)
            const res = fn()
            return res
        },
        [session, show, signin]
    )
}
