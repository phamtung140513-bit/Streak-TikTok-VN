import asyncio

from rich.console import Console

from core.browser import get_browser
from utils.config import normalize_unique_id, upsert_user_account


console = Console()

READY_SELECTOR = (
    'xpath=//*[contains(@id, "garfish_app_for_douyin_creator_pc_home")]'
    '/div/div[2]/div/div[2]/div[1]'
)
XPATHS = {
    "unique_id": (
        'xpath=//*[contains(@id, "garfish_app_for_douyin_creator_pc_home")]'
        '/div/div[2]/div/div[2]/div[1]/div[2]/div[1]/div[3]'
    ),
    "name": (
        'xpath=//*[contains(@id, "garfish_app_for_douyin_creator_pc_home")]'
        '/div/div[2]/div/div[2]/div[1]/div[2]/div[1]/div[1]/div[1]'
    ),
}


async def wait_for_logged_in_identity(page, timeout_ms=300000):
    await page.wait_for_selector(READY_SELECTOR, timeout=timeout_ms)

    unique_id_element = await page.wait_for_selector(XPATHS["unique_id"], timeout=timeout_ms)
    name_element = await page.wait_for_selector(XPATHS["name"], timeout=timeout_ms)

    unique_id_text = await unique_id_element.inner_text()
    username = (await name_element.inner_text()).strip()
    unique_id = normalize_unique_id(unique_id_text)
    return unique_id, username


async def collect_login_result(page, context, timeout_ms=300000):
    unique_id, username = await wait_for_logged_in_identity(page, timeout_ms=timeout_ms)
    cookies = await context.cookies()
    return {
        "unique_id": unique_id,
        "username": username,
        "cookies": cookies,
    }


async def userLogin(targets=None):
    playwright, browser = await get_browser(GUI=True)
    try:
        context = await browser.new_context()
        page = await context.new_page()

        await page.goto("https://creator.douyin.com/")
        console.print("Please scan the QR code and finish logging into Douyin Creator Center.")

        login_result = await collect_login_result(page, context)
        console.print(f"Unique ID: {login_result['unique_id']}")
        console.print(f"Name: {login_result['username']}")
        console.print(f"Cookies: found {len(login_result['cookies'])} cookies")

        if targets is None:
            raw_targets = input(
                "Open Creator Center -> 互动管理 -> 私信管理 -> 朋友私信, then enter friend display names separated by spaces: "
            )
            targets = [target.strip() for target in raw_targets.split(" ") if target.strip()]

        account = upsert_user_account(
            login_result["unique_id"],
            login_result["username"],
            login_result["cookies"],
            targets,
        )
        console.print(f"[bold green]Login complete. Updated account {account['username']}.[/bold green]")
        return account
    finally:
        await playwright.stop()
        await browser.close()


if __name__ == "__main__":
    asyncio.run(userLogin())
