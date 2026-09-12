import argparse
import asyncio

from rich.console import Console
from rich.prompt import Prompt

from core.login import userLogin
from utils.github_action_config import print_github_action_config


console = Console()


def interactive_cli():
    console.print("[bold green]Welcome to DouYin Spark Flow[/bold green]")
    console.print("[bold yellow]Choose an action:[/bold yellow]")
    console.print("[cyan]1.[/cyan] Add account login")
    console.print("[cyan]2.[/cyan] Export USER_DATA for GitHub Actions")
    console.print("[cyan]3.[/cyan] Run task locally")
    console.print("[cyan]4.[/cyan] Start Web Admin UI")

    choice = Prompt.ask("Enter a choice (1/2/3/4)", choices=["1", "2", "3", "4"])

    if choice == "1":
        console.print("[bold blue]Starting account login...[/bold blue]")
        while True:
            asyncio.run(userLogin())
            if Prompt.ask("Continue adding accounts? (y/n)", choices=["y", "n"]) == "n":
                break
    elif choice == "2":
        print_github_action_config()
    elif choice == "3":
        from core.tasks import runTasks

        asyncio.run(runTasks())
    else:
        from webui.app import run_web_app

        run_web_app()


def build_parser():
    parser = argparse.ArgumentParser(description="DouYin Spark Flow")
    parser.add_argument("--doTask", action="store_true", help="Run the message task immediately")
    parser.add_argument("--web", action="store_true", help="Start the Web Admin UI")
    parser.add_argument("--host", default=None, help="Web UI bind host")
    parser.add_argument("--port", type=int, default=None, help="Web UI bind port")
    return parser


if __name__ == "__main__":
    parser = build_parser()
    args = parser.parse_args()

    if args.doTask:
        from core.tasks import runTasks

        asyncio.run(runTasks())
    elif args.web:
        from webui.app import run_web_app

        run_web_app(host=args.host, port=args.port)
    else:
        interactive_cli()
