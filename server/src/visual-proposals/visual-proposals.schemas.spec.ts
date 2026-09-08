import { describe, expect, it } from 'vitest'
import { generateProposalFieldsSchema } from './visual-proposals.schemas.js'

describe('visual proposal consent', () => {
  it('allows a neutral proposal without a space photo consent', () => {
    expect(generateProposalFieldsSchema.safeParse({ mode: 'NEUTRAL', spacePhotoConsent: 'false' }).success).toBe(true)
  })

  it('rejects contextual mode without explicit consent', () => {
    expect(generateProposalFieldsSchema.safeParse({ mode: 'CONTEXTUAL', spacePhotoConsent: 'false' }).success).toBe(false)
  })

  it('allows contextual mode after explicit consent', () => {
    expect(generateProposalFieldsSchema.safeParse({ mode: 'CONTEXTUAL', spacePhotoConsent: 'true' }).success).toBe(true)
  })

  it('rejects space consent in neutral mode', () => {
    expect(generateProposalFieldsSchema.safeParse({ mode: 'NEUTRAL', spacePhotoConsent: 'true' }).success).toBe(false)
  })
})
