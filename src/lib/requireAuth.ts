// src/lib/requireAuth.ts
import { useAuth } from 'amvault-connect'
import { useNavigate } from 'react-router-dom'
import { useEffect } from 'react'
import { useToast } from '../components/Toast'

export function useRequireAuth(actionLabel = 'perform this action') {
    const { session, status, signin } = useAuth()
    const nav = useNavigate()
    const { show } = useToast()

    useEffect(() => {
        if (status === 'ready' && !session) {
            // Show snackbar
            show({
                title: 'Login required',
                desc: `You must connect AmVault to ${actionLabel}.`,
                action: { label: 'Connect AmVault', onClick: () => signin() },
                duration: 6000,
            })
            // Redirect
            nav('/proposals')
        }
    }, [session, status, nav, show, signin, actionLabel])

    return { session, status }
}
