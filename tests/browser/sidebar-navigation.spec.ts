import {test,expect} from '@playwright/test';
// Runs against an isolated Next fixture containing the production SidebarLink
// and delayed routes /one, /two, /three. No auth, DB or provider access.
test('one click acknowledges a delayed route and clears when navigation finishes',async({page})=>{
 await page.goto('/one');
 await page.locator('a[href="/two"]').click();
 await expect(page.locator('a[href="/two"] [role="status"]')).toBeVisible({timeout:1000});
 await expect(page.getByRole('heading',{name:'two',exact:true})).toBeVisible();
 await expect(page.locator('nav [role="status"]')).toHaveCount(0);
 await expect(page.locator('a[href="/two"]')).toHaveAttribute('aria-current','page');
});
test('rapid navigation accepts the latest click without disabling links or stale progress',async({page})=>{
 await page.goto('/one');
 await page.locator('a[href="/two"]').click();
 await page.locator('a[href="/three"]').click();
 await expect(page.locator('a[href="/three"] [role="status"]')).toBeVisible({timeout:1000});
 await expect(page.getByRole('heading',{name:'three',exact:true})).toBeVisible();
 await expect(page.locator('nav [role="status"]')).toHaveCount(0);
 await page.locator('a[href="/one"]').click();
 await expect(page.getByRole('heading',{name:'one',exact:true})).toBeVisible();
});
