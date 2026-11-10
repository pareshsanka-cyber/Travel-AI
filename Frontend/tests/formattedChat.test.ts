import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanStrayMarkdown, renderInlineContent } from '../src/components/FormattedChatMessage';
import { checkTripPlanningConstraints } from '../src/services/api';

test('cleanStrayMarkdown removes stray asterisks and backticks', () => {
  assert.equal(cleanStrayMarkdown('**Hyderabad → Bangkok**'), 'Hyderabad → Bangkok');
  assert.equal(cleanStrayMarkdown('Estimated budget *₹30,000*'), 'Estimated budget ₹30,000');
  assert.equal(cleanStrayMarkdown('Trailing stars *** and * and **'), 'Trailing stars  and  and ');
  assert.equal(cleanStrayMarkdown('Inline `code` token'), 'Inline code token');
});

test('renderInlineContent parses bold, italic, and inline code without raw stars', () => {
  const nodes = renderInlineContent('Great choice! Trip to **Bangkok** for *7 Days* with `Fast` pass.');
  // Confirm nodes are produced
  assert.ok(Array.isArray(nodes));
  assert.ok(nodes.length > 0);

  // No node should contain raw '**' or '*' in text
  for (const node of nodes) {
    if (typeof node === 'string') {
      assert.ok(!node.includes('**'));
      assert.ok(!node.includes('*'));
    }
  }
});

test('checkTripPlanningConstraints excludes interests from missing constraint alerts', () => {
  // Case: Destination and duration provided, but missing budget & travelers
  const res = checkTripPlanningConstraints('Plan a 5-day trip to Goa', {});
  assert.equal(res.isFullySatisfied, false);
  assert.ok(res.guidanceMessage);

  // Must alert for Budget and Travelers
  assert.match(res.guidanceMessage, /Budget/i);
  assert.match(res.guidanceMessage, /Travelers/i);

  // Must NOT list Interests under missing constraints
  assert.ok(!res.guidanceMessage.includes('**Interests**'));
  assert.ok(!res.guidanceMessage.includes('- ✨'));
});

test('checkTripPlanningConstraints is fully satisfied without interests', () => {
  // When Where, When, Budget, and Travelers are provided, it is satisfied even without interests
  const res = checkTripPlanningConstraints('Plan a 3-day trip to Paris for 2 adults with budget 100000', {});
  assert.equal(res.isFullySatisfied, true);
  assert.equal(res.mergedContext.destination, 'Paris');
  assert.equal(res.mergedContext.days, 3);
  assert.equal(res.mergedContext.budget, 100000);
});
