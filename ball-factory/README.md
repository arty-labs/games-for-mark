# Ball Factory

A glowing ball machine made for Mark. A friendly truck dumps colourful balls into a factory of neon pipes. The balls roll down ramps, small ones drop through the sieve and bounce through the peg board, and big ones get crunched into little ones by the gears. Everything ends up melting in the lava, which fills the thermometer. Fill it and you get fireworks.

**How to play**
- Pick who's playing on the start screen (tap **+** to add a name), then press play and choose a level.
- Each level gives you a few trucks of balls and a goal: melt that many balls in the lava before the trucks run out.
- Tap the truck to dump its balls. Tap it while it's driving to make it hurry (that's how you get 3 stars on the hard levels).
- Tap the machines to speed them up: spinners, belts, pistons, gears. Buckets tip, trapdoors open and flippers flip when tapped.
- Tapping empty space drops a white-ringed bonus ball. It's just for fun and doesn't count toward the goal.
- The timer starts with the first truck. Faster finishes earn more stars and a bigger score.

**Stars and unlocking**
- Levels 2 to 5 unlock with 1 star on the level before.
- Levels 6 to 12 need 2 stars on the level before.
- Levels 13 to 20 need 3 stars on the level before.

**Boosters** (bottom-left buttons)
- 🚚 Extra truck: one more load of balls for this level. Also offered when you run out.
- ⚡ Turbo: every machine and the truck run at full speed for 10 seconds.
- You start with 3 of each. 2 stars earns a ⚡, 3 stars earns a 🚚.

**Leaderboard**: the 🏆 button on the level screen shows the top scores and each player's progress. Scores are saved on the iPad itself (there's no online server), so they stay on that device.

**Levels**: 1 The Crusher, 2 Wheels & Belts, 3 Lift & Hammer, 4 Flipper Fun, 5 Bumper Alley, 6 Belt Run, 7 The Sifter, 8 Gear Grinder, 9 Push It, 10 Trap Time, 11 Hammer Row, 12 Flipper Pit, 13 Bucket Brigade, 14 Sort & Smash, 15 Busy Belts, 16 Crunch Time, 17 Pinball Plant, 18 Double Trouble, 19 Mega Mill, 20 The Big Machine.

Each level's goal and star times are in the `TUNING` table near the top of `game.js` if you want to make a level easier or harder.

It works offline once it has been opened once, and it plays best with the iPad sideways.

## Files

| File | What it is |
|---|---|
| `index.html` | The page, start screen and iOS home-screen settings |
| `game.js` | The whole game (physics, drawing, sounds) |
| `manifest.webmanifest` | Tells the iPad the app's name, icon and full-screen mode |
| `sw.js` | Service worker that saves the game for offline play |
| `icons/` | Home-screen icons |

## Try it on your PC

The service worker needs a real web server (opening `index.html` directly from disk only half works). From this folder:

```
python -m http.server 8000
```

Then open http://localhost:8000 in a browser.

## Put it online with GitHub Pages (free)

The iPad needs the game on an `https://` address to install it properly.

1. Go to https://github.com/new, name the repository something like `ball-factory`, set it to **Public**, and click **Create repository**.
2. On the new repository page, click **uploading an existing file**, drag in everything from this folder (including the `icons` folder), and click **Commit changes**.
   (Or with git: `git init`, `git add .`, `git commit -m "Ball Factory"`, then the `git remote add` and `git push` lines GitHub shows you.)
3. In the repository, go to **Settings → Pages**. Under **Build and deployment**, set Source to **Deploy from a branch**, choose branch **main** and folder **/ (root)**, and click **Save**.
4. Wait a minute or two. The page shows your address, like `https://YOUR-NAME.github.io/ball-factory/`.

Other free options that also work: Netlify Drop (https://app.netlify.com/drop, just drag the folder in) or Cloudflare Pages.

## Add it to the iPad home screen

1. On the iPad, open the address in **Safari** (it has to be Safari).
2. Tap the **Share** button (the square with the arrow pointing up).
3. Scroll down and tap **Add to Home Screen**, then **Add**.
4. Open **Ball Factory** from the home screen. It opens full screen like a normal app and keeps working without Wi-Fi.

Tip: if sound doesn't play, check the iPad's silent switch / volume and the speaker button in the game.

### Optional: lock Mark inside the game

Settings → Accessibility → **Guided Access** → turn it on. Open the game, triple-click the top (or home) button, and tap Start. Triple-click again and enter the code to leave.

## Updating the game later

After changing any file, open `sw.js` and bump the version (`ball-factory-v1` → `ball-factory-v2`), then upload the files again. The iPad picks up the new version the next time the game is opened with internet (sometimes it takes a second launch).
