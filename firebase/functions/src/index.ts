
import * as functions from 'firebase-functions'
import * as admin from 'firebase-admin'

admin.initializeApp()
const db = admin.firestore()

// TODO: verify AmVault signatures here.
export const createProposal = functions.https.onCall(async (data, context) => {
  // Example: require a server token or implement a signature check
  const { title, bodyMd, category } = data
  if (!title || !bodyMd) {
    throw new functions.https.HttpsError('invalid-argument', 'Missing title/body')
  }
  const doc = await db.collection('proposals').add({
    title,
    bodyMd,
    category: category ?? 'General',
    status: 'Submitted',
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    author: { name: 'AmID-xxxx', address: '0x...', avatar: Math.floor(Math.random()*4)+1 },
    counters: { comments: 0, votes: 0 },
    amount: null,
  })
  return { id: doc.id }
})
