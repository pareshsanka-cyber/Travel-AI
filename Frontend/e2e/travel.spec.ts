import { test, expect, Page } from '@playwright/test';

const backend = 'http://127.0.0.1:8000';
const user = { id:'browser-user', name:'Test Explorer', email:'test@example.com' };
function fixtureTrip() {
  return { plus_access:true, id:'browser-trip', destination:'Goa', days:2, travelers:2, budget:15000, currency:'INR', start_date:'2026-12-01', end_date:'2026-12-02',
    destination_timezone:'Asia/Kolkata', revision:1, selections:{flight_id:'f1',hotel_id:'h1'},
    flights:[{id:'f1',airline:'Test Airline',flight_number:'TA 101',departure_time:'08:00',arrival_time:'10:00',price:1000},
             {id:'f2',airline:'Test Airline',flight_number:'TA 202',departure_time:'09:00',arrival_time:'11:00',price:1500}],
    hotels:[{id:'h1',name:'Harbor Hotel',address:'Goa',price_per_night:2000,total_cost:2000,amenities:[],lat:15.5,lon:73.8},
            {id:'h2',name:'Garden Hotel',address:'Goa',price_per_night:3000,total_cost:3000,amenities:[],lat:15.5,lon:73.8}],
    weather:{data_status:'unavailable'}, budget_breakdown:{flight_cost:2000,hotel_cost:2000,notes:'Food and transport excluded.'},
    execution_state:{is_active:false,current_day_number:1,activity_log:{},reroute_history:[]},
    route_details:{day_by_day_route:[{day:1,date:'2026-12-01',title:'First day',stops:[{id:'museum',name:'Goa Museum',title:'Goa Museum',type:'attraction',start_time:'09:00',end_time:'10:00',time:'09:00 - 10:00',description:'Explore local history.'}]},
      {day:2,date:'2026-12-02',title:'Second day',stops:[{id:'beach',name:'Calangute Beach',title:'Calangute Beach',type:'attraction',start_time:'10:00',end_time:'11:00',time:'10:00 - 11:00',description:'Enjoy the coast.'}]}]} };
}

async function installMock(page: Page, options: { loginFails?: boolean; expired?: boolean; emptyHistory?: boolean } = {}) {
  let trip = fixtureTrip();
  let generated = !options.emptyHistory;
  let revoked = false;
  await page.addInitScript(({ backend, expired }) => {
    localStorage.setItem('TRAVELAI_FASTAPI_URL', backend);
    if (expired) { localStorage.setItem('travelai_token', 'expired'); localStorage.setItem('travelai_user', '{}'); }
  }, { backend, expired:options.expired });
  await page.route(`${backend}/**`, async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/auth/login' && options.loginFails) { await route.abort('connectionrefused'); return; }
    let status = 200, data: any = {};
    if (path === '/api/auth/login') data = {token:'browser-session',user};
    else if (path === '/api/auth/me') { status = options.expired || revoked ? 401 : 200; data = status === 200 ? {user} : {detail:'Session expired'}; }
    else if (path === '/api/auth/logout') { revoked = true; data = {success:true}; }
    else if (path === '/api/trips/history') data = generated ? [trip] : [];
    else if (path === '/api/bookings/status') data = { trip_id: trip.id, current: [], previous: [] };
    else if (path === '/api/chat/conversations' || path === '/api/bookings/history') data = [];
    else if (path === '/api/trips/browser-trip') data = trip;
    else if (path.endsWith('/selections')) {
      expect(route.request().headers().authorization).toBe('Bearer browser-session');
      const body = route.request().postDataJSON();
      expect(body.expected_revision).toBe(trip.revision);
      trip = { ...trip, revision:trip.revision + 1, selections:{...trip.selections,...(body.flight_id ? {flight_id:body.flight_id} : {}),...(body.hotel_id ? {hotel_id:body.hotel_id} : {})} };
      data = {status:'success',trip};
    } else if (path === '/api/chat/message') {
      generated = true;
      data = {conversation_id:'browser-conversation',intent:'GENERATE_ITINERARY',message:{role:'assistant',content:'Your itinerary is ready.'},
        travel_context:{destination:'Goa',origin:'Hyderabad',days:2,travelers:2,budget:15000,currency:'INR'},data:{type:'itinerary',trip_id:trip.id,itinerary:trip}};
    } else if (path === '/' || path === '/health/ready') data = {status:'ok'};
    await route.fulfill({status,json:data});
  });
  // Tests use fixtures, never real travel providers or accounts.
  await page.route('https://**/*', route => route.abort());
}

async function signIn(page: Page) {
  await page.goto('/');
  await page.getByRole('textbox',{name:'Email',exact:true}).fill(user.email);
  await page.getByLabel('Password',{exact:true}).fill('valid-password');
  await page.getByRole('button',{name:'Sign In',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Goa Curated Itinerary',exact:true})).toBeVisible();
}

test('network failures cannot create an authenticated session', async ({page}) => {
  await installMock(page,{loginFails:true});
  await page.goto('/');
  await page.getByRole('textbox',{name:'Email',exact:true}).fill(user.email);
  await page.getByLabel('Password',{exact:true}).fill('any-password');
  await page.getByRole('button',{name:'Sign In',exact:true}).click();
  await expect(page.getByRole('alert')).toContainText('Unable to reach');
  expect(await page.evaluate(() => localStorage.getItem('travelai_token'))).toBeNull();
});

test('expired stored sessions return to login', async ({page}) => {
  await installMock(page,{expired:true});
  await page.goto('/');
  await expect(page.getByRole('button',{name:'Sign In',exact:true})).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('travelai_token'))).toBeNull();
});

test('choices persist after reloading and calendar contains actual visits', async ({page}) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await installMock(page); await signIn(page);
  await page.getByRole('button',{name:/^Hotels \(/}).first().click();
  await page.getByRole('button',{name:'Select Stay',exact:true}).click();
  await expect(page.getByText('Selected Stay',{exact:true})).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading',{name:'Goa Curated Itinerary',exact:true})).toBeVisible();
  if (await page.getByRole('button',{name:'Open navigation menu'}).isVisible()) await page.getByRole('button',{name:'Open navigation menu'}).click();
  await page.getByRole('button',{name:'Travel Selections',exact:true}).click();
  await expect(page.getByText('Garden Hotel',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Open Planner Studio',exact:true}).click();
  const downloadEvent = page.waitForEvent('download');
  await expect(page.locator('.trip-dashboard')).toBeVisible();
  const moreActions = page.locator('.trip-more-actions > summary'); if (await moreActions.isVisible()) await moreActions.click();
  await page.getByRole('button',{name:'Download itinerary calendar',exact:true}).click();
  const download = await downloadEvent;
  expect(download.suggestedFilename()).toBe('travelai-goa.ics');
  const stream = await download.createReadStream();
  let calendar = ''; for await (const chunk of stream!) calendar += chunk.toString();
  expect(calendar).toContain('DTSTART:20261201T033000Z');
  expect(calendar).toContain('SUMMARY:Goa Museum');
  expect(errors).toEqual([]);
  const width = await page.evaluate(() => ({viewport:innerWidth,document:document.documentElement.scrollWidth}));
  expect(width.document).toBeLessThanOrEqual(width.viewport + 1);
});

test('a new traveler can create an itinerary and sign out', async ({page}) => {
  await installMock(page,{emptyHistory:true}); await page.goto('/');
  await page.getByLabel('Email',{exact:true}).fill(user.email);
  await page.getByLabel('Password',{exact:true}).fill('valid-password');
  await page.getByRole('button',{name:'Sign In',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Plan your next trip'})).toBeVisible();
  await page.locator('#chatPromptInput').fill('Plan a 2-day trip from Hyderabad to Goa for 2 adults with a budget of INR 15000');
  await page.locator('#chatPromptInput').press('Enter');
  await expect(page.getByRole('heading',{name:'Goa Curated Itinerary',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'User Profile',exact:true}).click();
  const logout = page.waitForRequest(`${backend}/api/auth/logout`);
  await page.getByRole('button',{name:'Sign Out',exact:true}).click();
  await logout;
  await expect(page.getByRole('button',{name:'Sign In',exact:true})).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('travelai_token'))).toBeNull();
});

test('Trip details allows future dates and rejects a newly entered past date', async ({ page }) => {
  await page.clock.install({ time: new Date('2030-06-15T12:00:00Z') });
  await installMock(page); await signIn(page);
  const menu = page.getByRole('button', { name: 'Open navigation menu' }); if (await menu.isVisible()) await menu.click();
  await page.getByRole('button', { name: 'Plan', exact: true }).click();
  await page.getByRole('button', { name: 'Trip details', exact: true }).click();
  const details = page.getByRole('dialog', { name: 'Trip details', exact: true });
  await expect(details.getByLabel('Start date', { exact: true })).toHaveAttribute('min', '2030-06-15');
  await details.getByLabel('Start date', { exact: true }).fill('2030-06-14');
  await details.getByRole('button', { name: 'Apply trip details', exact: true }).click();
  await expect(details.getByRole('alert')).toContainText('Choose today or future dates');
  await details.getByLabel('Start date', { exact: true }).fill('2030-06-15');
  await details.getByLabel('End date', { exact: true }).fill('2030-06-17');
  await details.getByRole('button', { name: 'Apply trip details', exact: true }).click();
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('TRAVELAI_TRAVEL_CONTEXT') || '{}').start_date)).toBe('2030-06-15');
});
