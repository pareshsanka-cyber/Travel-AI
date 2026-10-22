import test from 'node:test';
import assert from 'node:assert/strict';
import type { PlaceRecommendation, SuggestedAction } from '../src/types/index';

// Polyfill localStorage for node:test environment if undefined
if (typeof globalThis.localStorage === 'undefined') {
  const store = new Map<string, string>();
  Object.assign(globalThis, {
    localStorage: {
      getItem: (k: string) => store.get(k) || null,
      setItem: (k: string, v: string) => store.set(k, v),
      removeItem: (k: string) => store.delete(k),
      clear: () => store.clear(),
    }
  });
}

import { sendChatMessage } from '../src/services/api';

test('sendChatMessage correctly parses place recommendations and suggested actions into richContent', async () => {
  const originalFetch = globalThis.fetch;
  const samplePlace: PlaceRecommendation = {
    name: 'Amber Palace',
    category: 'monument',
    description: 'Iconic 16th-century hilltop palace fort.',
    latitude: 26.9855,
    longitude: 75.8513,
    address: 'Amer, Jaipur, Rajasthan 302001',
    distance_meters: 1200,
    travel_duration_minutes: null,
    rating: 4.7,
    review_count: 125000,
    opening_status: 'OPEN',
    source: 'google_maps',
    source_url: 'https://www.google.com/maps/search/?api=1&query=26.9855,75.8513',
    image_url: 'https://example.com/amber.jpg',
    reason_recommended: 'Matches your interest in Heritage · Top-rated landmark',
    supported_actions: ['view_details', 'directions', 'add_to_itinerary', 'ask_followup']
  };

  const sampleAction: SuggestedAction = {
    label: 'Tell me more about Amber Palace',
    action: 'ask_followup',
    payload: { name: 'Amber Palace' }
  };

  const mockApiResponse = {
    conversation_id: 'conv_123',
    intent: 'TRAVEL_QA',
    message: {
      role: 'assistant',
      content: 'Here are top verified heritage sights in Jaipur.'
    },
    travel_context: {
      destination: 'Jaipur',
      interests: ['heritage']
    },
    data: {
      type: 'place_recommendations',
      category: 'INTEREST_RECOMMENDATIONS',
      destination: 'Jaipur',
      user_location_used: false,
      places: [samplePlace],
      suggested_actions: [sampleAction]
    }
  };

  try {
    globalThis.fetch = (async (url, options) => {
      const body = JSON.parse(String(options?.body || '{}'));
      assert.equal(body.message, 'Famous heritage spots in Jaipur');
      assert.equal(body.destination, 'Jaipur');
      return new Response(JSON.stringify(mockApiResponse), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }) as typeof fetch;

    const { replyMessage, rawResponse } = await sendChatMessage(
      'Famous heritage spots in Jaipur',
      'conv_123',
      { destination: 'Jaipur' }
    );

    assert.equal(replyMessage.sender, 'assistant');
    assert.equal(replyMessage.text, 'Here are top verified heritage sights in Jaipur.');
    assert.ok(replyMessage.richContent, 'richContent should be present');
    
    // Check place card fields
    const places = replyMessage.richContent?.placeRecommendations;
    assert.ok(Array.isArray(places));
    assert.equal(places?.length, 1);
    const p = places?.[0]!;
    assert.equal(p.name, 'Amber Palace');
    assert.equal(p.rating, 4.7);
    assert.equal(p.review_count, 125000);
    assert.equal(p.opening_status, 'OPEN');
    assert.equal(p.distance_meters, 1200);
    assert.equal(p.travel_duration_minutes, null); // never invent walking duration
    assert.deepEqual(p.supported_actions, ['view_details', 'directions', 'add_to_itinerary', 'ask_followup']);

    // Check suggested action pills
    const actions = replyMessage.richContent?.suggestedActions;
    assert.ok(Array.isArray(actions));
    assert.equal(actions?.length, 1);
    assert.equal(actions?.[0].label, 'Tell me more about Amber Palace');
    assert.equal(actions?.[0].action, 'ask_followup');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('sendChatMessage sends GPS coordinates when available without fabricating missing coordinates', async () => {
  const originalFetch = globalThis.fetch;
  const sentPayloads: any[] = [];

  try {
    globalThis.fetch = (async (_url, options) => {
      const body = JSON.parse(String(options?.body || '{}'));
      sentPayloads.push(body);
      return new Response(JSON.stringify({
        conversation_id: 'conv_gps',
        intent: 'TRAVEL_QA',
        message: { role: 'assistant', content: 'Nearby places found.' },
        data: null
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }) as typeof fetch;

    // Call with GPS
    await sendChatMessage('Find cafes near me', 'conv_gps', {
      current_lat: 26.9124,
      current_lon: 75.7873
    });
    assert.equal(sentPayloads[0].current_lat, 26.9124);
    assert.equal(sentPayloads[0].current_lon, 75.7873);

    // Call without GPS
    await sendChatMessage('What places are nearby?', 'conv_gps', {});
    assert.equal(sentPayloads[1].current_lat, undefined);
    assert.equal(sentPayloads[1].current_lon, undefined);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
