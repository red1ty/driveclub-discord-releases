# driveclub-discord-releases

Posts each new release of [OverkillLabs3/driveclub-recomp](https://github.com/OverkillLabs3/driveclub-recomp) to `#releases` in the Driveclub Native Runtime Discord, and pings `@Release Pings`.

A scheduled workflow checks every 15 minutes. Anything published after the tag in `state/last-tag.txt` is posted (oldest first), then that file is updated. Drafts and pre-releases are skipped.

## Settings

| Name | Kind | What it is |
|---|---|---|
| `DISCORD_WEBHOOK_URL` | secret | The "Driveclub Releases" webhook in `#releases` |
| `RELEASE_PING_ROLE` | variable | Role id of `@Release Pings` (leave empty to post without a ping) |

## Run it by hand

Actions → **Post new releases to Discord** → **Run workflow**. Tick *dry run* to check without posting.

To repost a specific release from your own machine:

```sh
DISCORD_WEBHOOK_URL=... RELEASE_TAG=v0.3.1 node post-release.mjs
```
