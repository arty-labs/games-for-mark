# Ball Factory

A glowing ball machine made for Mark. A friendly truck dumps colourful balls into a factory of neon pipes. The balls roll down ramps, small ones drop through the sieve and bounce through the peg board, and big ones get crunched into little ones by the gears. Everything ends up melting in the lava, which fills the thermometer. Fill it and you get fireworks.

**How to play**
- Tap the truck (when the hand is pointing at it) to dump a load of balls.
- Tap anywhere else to drop a ball there.
- Tap the gears to make them spin super fast, tap the pegs or the star to make sounds.
- The speaker button in the corner turns sound on and off.

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
