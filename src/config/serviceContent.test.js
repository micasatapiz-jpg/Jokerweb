import assert from 'node:assert/strict'
import test from 'node:test'
import { serviceContent } from './serviceContent.js'
import { publicPages } from './seo.js'

test('every service has buying guidance, valid related destinations and distinct questions', () => {
  assert.equal(Object.keys(serviceContent).length, 6)
  const questions = new Set()
  for (const [slug, content] of Object.entries(serviceContent)) {
    assert.ok(publicPages[`/servicios/${slug}`], slug)
    assert.ok(content.heading.includes('Lima'), slug)
    assert.ok(content.introduction.length > 100 && content.selection.length > 100, slug)
    assert.equal(content.requirements.length, 4, slug)
    assert.equal(content.questions.length, 3, slug)
    for (const [question, answer] of content.questions) {
      assert.ok(!questions.has(question), question)
      questions.add(question)
      assert.ok(answer.length > 60, question)
    }
  }
})
