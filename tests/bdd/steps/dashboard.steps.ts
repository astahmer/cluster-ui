import { expect, type Page } from "@playwright/test"
import { createBdd } from "playwright-bdd"

const { Given, When, Then, Before } = createBdd()
const pageErrors = new WeakMap<Page, string[]>()

const routeFor = (route: string) => route.replace(/^\//, "").toLowerCase()

Before(async ({ page }) => {
  const errors: string[] = []
  pageErrors.set(page, errors)
  page.on("pageerror", (error) => errors.push(String(error)))
  await page.addInitScript(() => {
    localStorage.removeItem("cluster_ui_cluster")
    localStorage.removeItem("cluster_ui_saved_views")
  })
  await page.goto("/#/overview")
})

Given("I am on the {string} route", async ({ page }, route: string) => {
  await page.goto(`/#/${routeFor(route)}`)
})

When("I navigate to {string}", async ({ page }, route: string) => {
  await page.goto(`/#/${routeFor(route)}`)
})

Then("the page body contains {string}", async ({ page }, text: string) => {
  await expect(page.locator("body")).toContainText(text, { ignoreCase: true })
})

Then("I can see {string}", async ({ page }, text: string) => {
  await expect(page.locator("body")).toContainText(text, { ignoreCase: true })
})

Then("the page has no application errors", async ({ page }) => {
  await page.waitForTimeout(300)
  const errors = pageErrors.get(page) ?? []
  expect(errors, errors.join("\n")).toEqual([])
})

When("I open the command palette", async ({ page }) => {
  await page.getByRole("button", { name: "open command palette" }).first().click()
})

When("I choose the command {string}", async ({ page }, command: string) => {
  await page.getByRole("option", { name: command, exact: false }).click()
})

When("I switch to the {string} cluster", async ({ page }, cluster: string) => {
  await page.getByRole("combobox", { name: "cluster" }).selectOption(cluster)
  await page.waitForTimeout(500)
})

When("I open the first message row", async ({ page }) => {
  await page.locator("table tbody tr").first().click()
  await page.waitForTimeout(300)
})

Then("the message detail panel is visible", async ({ page }) => {
  await expect(page.locator('[data-testid="message-detail"], .fixed.inset-0').first()).toBeVisible()
})

When("I reload the current URL", async ({ page }) => {
  await page.reload({ waitUntil: "domcontentloaded" })
  await page.waitForTimeout(500)
})

When("I choose the {string} message tab", async ({ page }, tab: string) => {
  await page.getByRole("tab", { name: tab, exact: true }).click()
  await page.waitForTimeout(400)
})

When("I search messages for {string}", async ({ page }, query: string) => {
  await page.getByRole("textbox", { name: "search messages" }).fill(query)
  await page.waitForTimeout(500)
})

When("I change the message page size to {string}", async ({ page }, size: string) => {
  await page.getByRole("combobox", { name: "page size" }).selectOption(size)
  await page.waitForTimeout(300)
})

When("I export messages as JSON", async ({ page }) => {
  const download = page.waitForEvent("download")
  await page.getByRole("button", { name: "export page (json)" }).click()
  await download
})

When("I browse the {string} queue jobs", async ({ page }, queue: string) => {
  const row = page.locator("table tbody tr", { hasText: queue }).first()
  await row.getByRole("button", { name: "Browse jobs" }).click()
  await page.waitForTimeout(500)
})

Then("the queue jobs browser is visible", async ({ page }) => {
  await expect(page.getByText(/individual BullMQ jobs/)).toBeVisible()
})

When("I inspect the first queue job", async ({ page }) => {
  await page.getByRole("button", { name: "inspect" }).first().click()
  await page.waitForTimeout(300)
})

Then("the queue job detail dialog is visible", async ({ page }) => {
  await expect(page.getByRole("dialog")).toBeVisible()
})

When("I choose the {string} queue-job state", async ({ page }, state: string) => {
  await page.getByRole("button", { name: state, exact: true }).click()
  await page.waitForTimeout(400)
})

When("I promote the first delayed queue job", async ({ page }) => {
  await page.getByRole("button", { name: "promote" }).first().click()
  await page.waitForTimeout(500)
})

When("I pause the {string} queue", async ({ page }, queue: string) => {
  const row = page.locator("table tbody tr", { hasText: queue }).first()
  await row.getByRole("button", { name: "Pause" }).click()
  await page.getByRole("dialog").getByRole("button", { name: "Pause", exact: true }).click()
  await expect(row.getByRole("button", { name: "Resume" })).toBeVisible()
})

When("I resume the {string} queue", async ({ page }, queue: string) => {
  const row = page.locator("table tbody tr", { hasText: queue }).first()
  await row.getByRole("button", { name: "Resume" }).click()
  await expect(row.getByRole("button", { name: "Pause" })).toBeVisible()
})

When("I open the first workflow", async ({ page }) => {
  await page.locator('a[href^="#/workflows/"]').first().click()
  await page.waitForTimeout(500)
})

When("I open the first workflow run", async ({ page }) => {
  await page.locator("table tbody tr").first().click()
  await page.waitForTimeout(500)
})

Then("the workflow run detail panel is visible", async ({ page }) => {
  await expect(page.locator(".fixed.inset-0").first()).toBeVisible()
})

When("I choose the {string} workflow view", async ({ page }, view: string) => {
  await page.getByRole("button", { name: view, exact: true }).click()
  await page.waitForTimeout(300)
})

When("I open the first trace", async ({ page }) => {
  await page.locator("table tbody tr").first().click()
  await page.waitForTimeout(500)
})

When("I choose the {string} metrics range", async ({ page }, range: string) => {
  await page.getByRole("tab", { name: range, exact: true }).click()
  await page.waitForTimeout(400)
})

When("I select a time range on the {string} chart", async ({ page }, _label: string) => {
  const chart = page.locator('[role="img"][aria-label*="click and drag"]').first()
  const box = await chart.boundingBox()
  expect(box).not.toBeNull()
  await page.mouse.move(box!.x + 10, box!.y + box!.height / 2)
  await page.mouse.down()
  await page.mouse.move(box!.x + Math.max(20, box!.width - 10), box!.y + box!.height / 2, { steps: 5 })
  await page.mouse.up()
  await page.waitForTimeout(300)
})

When("I open the brushed messages view", async ({ page }) => {
  await page.locator('a[href^="#/messages?createdAfter="]').click()
  await page.waitForTimeout(400)
})

When("I save the current view as {string}", async ({ page }, name: string) => {
  page.once("dialog", (dialog) => void dialog.accept(name))
  await page.getByRole("button", { name: "save current view" }).click()
  await page.waitForTimeout(200)
})

When("I open the operations page", async ({ page }) => {
  await page.goto("/#/operations")
  await page.waitForTimeout(400)
})

When("I open the saved view {string}", async ({ page }, name: string) => {
  await page.getByRole("button", { name: new RegExp(name, "i") }).first().click()
  await page.waitForTimeout(400)
})

When("I open the add-job form for the {string} queue", async ({ page }, queue: string) => {
  const row = page.locator("table tbody tr", { hasText: queue }).first()
  await row.getByRole("button", { name: "Add job" }).click()
})

When("I add a job named {string}", async ({ page }, name: string) => {
  const dialog = page.getByRole("dialog")
  await dialog.getByRole("textbox", { name: "job name" }).fill(name)
  await dialog.getByRole("button", { name: "Add job", exact: true }).click()
  await expect(dialog).toBeHidden()
})

When("I open the clean form for the {string} queue", async ({ page }, queue: string) => {
  const row = page.locator("table tbody tr", { hasText: queue }).first()
  await row.getByRole("button", { name: "Clean…" }).click()
})

When("I clean at most {string} completed job", async ({ page }, count: string) => {
  const dialog = page.getByRole("dialog")
  await dialog.getByRole("spinbutton", { name: "max jobs to remove" }).fill(count)
  await dialog.getByRole("button", { name: "Remove jobs", exact: true }).click()
  await page.getByRole("dialog").getByRole("button", { name: "Remove jobs", exact: true }).click()
  await expect(dialog).toBeHidden()
})

When("the API session expires", async ({ page }) => {
  await page.route("**/api/config", (route) => route.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({ error: "unauthorized" }) }))
  await page.reload({ waitUntil: "domcontentloaded" })
  await expect(page.locator("body")).toContainText("Sign in to cluster-ui")
  await page.unroute("**/api/config")
  await page.route("**/api/auth", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) }))
})

When("I sign in with token {string}", async ({ page }, token: string) => {
  await page.getByRole("textbox", { name: "deployment token" }).fill(token)
  await page.getByRole("button", { name: "Sign in" }).click()
  await page.waitForTimeout(500)
  await page.unroute("**/api/auth")
})

