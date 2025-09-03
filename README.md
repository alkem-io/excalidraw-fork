
<p align="center"><a href="https://www.alkemio.org/" target="blank"><img src="https://alkem.io/logo.png" width="400" alt="Alkemio Logo" /></a></p>
<p align="center"><i>Enabling society to collaborate. Building a better future, together.</i></p>

## Alkemio fork of Excalidraw

### List of differences with standard Excalidraw
- Added ZoomToFit button to the zoom toolbar.
- Modified the paste functionality to avoid pasting elements (such as images) as JSON when editing text.
- Changed the toolbar Lock button behavior. Now it locks/unlocks elements instead of the tool in use.
- Changed the load from file behavior to fix multi-user collaboration bug. Now elements loaded will be inserted in the current scene instead of replacing all the elements of the scene.
- ~~ZoomToFit feature exposed through the external API~~ not anymore
- ~~Added ZoomToFit flag to initialData to fit items on load~~ not anymore
- ~~Added `hideLibraryButton` to the appState to be able to hide the button from outside~~ not anymore

### Testing locally inside Alkemio client
> Note: needs to be reviewed, last time I tried this it didn't work well
```bash
cd packages/excalidraw
npm link
cd ../../../client-web
npm link @alkemio/excalidraw --save
```

### Developing/debugging Excalidraw by itself
Excalidraw comes with a test application which loads a whiteboard in the browser's local storage and renders just the Excalidraw component.
It can be run at
```bash
cd packages/excalidraw
yarn
yarn start
```

### Developer Notes
- All our modifications are merged to `develop` branch.
- `master` branch is the original Excalidraw's `master` branch as is. By the time of writing this readme, it is unstable and shouldn't be released to production.
- Some tags are kept in the repo from versions released, but before version 0.18 we were not following the instructions in this Readme
- The version naming is as follows: vX.X.X-HHHHH-alkemio-R. Being X the original version of the Excalidraw's package, HHHHH the hash of the last commit of the applied (if any, normally we just release the Excalidraw's released commit, so this HHHHH is omitted), and R is the counter of released Alkemio packages.


### Upgrade procedure
Everytime Excalidraw releases a new package, they publish it in their [GitHub/releases](https://github.com/excalidraw/excalidraw/releases) and they indicate in which commit they have based the release.
For example release 0.18.0 is based on commit 817d8c553c3389650f8b4503984a6d4a5d2f0c11
If we want to base our release on a later commit applied in their master branch, we also can, but we have made the agreement of appending that hash to the package name (see point before -HHHHH-)

```bash
  git fetch --tags upstream
  git checkout master
  git pull
  git checkout -b <new-branch-name> <commit-hash>
  # example:
  # git checkout -b 0.18.0-alkemio-8 817d8c553c3389650f8b4503984a6d4a5d2f0c11  (taken from Excalidraw's GitHub releases page)

  # Then merge the Alkemio changes from our branch: develop
  git merge origin/develop
  # Solve the conflicts.
  # Make sure packages/excalidraw/package.json has the correct package version number.
  # 0.18.0 Same as the Excalidraw's released package where we base our release
  # -817d8c5 The commit hash, if we want to apply any later commits merged after the Excalidraw's release
  # example: 0.18.0-alkemio-8
  #      or: 0.18.0-817d8c5-alkemio-8

  # Then push
  git push --set-upstream origin <new-branch-name>
  # example: git push --set-upstream origin 0.18.0-alkemio-8
```
Create a Pull Request to develop in excalidraw-fork repository

### Automatic build and publish the new npm package (preferred method)
- Create a new Release in the [releases page](https://github.com/alkem-io/excalidraw-fork/releases)
-



### Manually build and publish the new npm package locally
Find in json files any `'alkemio-X'` and make sure the version matches the number that should be published.
`yarn:publish` is going to ask for the version number again and it can bump the number but you can just repeat the current version number if it's correct.

```bash
yarn
cd packages/excalidraw
yarn install
yarn build:esm
yarn pack
yarn publish
```

## Change Log
### v0.18.0-alkemio-2
- Removed unused customizations (zoomToFit and hideLibraryButton)
- Cleaned up Readme and made version updates easier

### v0.19.0-alkemio-1
- Released by mistake without Alkemio customizations

### Alkemio fork of Excalidraw v0.18.0-alkemio-1
- Version bump to `0.18.0-alkemio-1`

### Alkemio fork of Excalidraw v0.17.0-alkemio-8
- Version bump to `0.17.1-alkemio-8`
- `reconcileElements` exposed to the public API
- `addElementsFromPasteOrLibrary` exposed to the public API
- opening a file now inserts elements in the current scene. Does not overwrite them anymore.

### Alkemio fork of Excalidraw v0.17.0-alkemio-4
- Added `hideLibraryButton` to the appState to be able to hide the button from outside.
- Changed the toolbar Lock button behavior. Now it locks/unlocks elements instead of the tool in use

### Alkemio fork of Excalidraw v0.17.0-alkemio-3-beta
- Changed behavior. Pasting elements is better handled and now it doesn't end up as a big text node with JSON inside.

### Alkemio fork of Excalidraw v0.17.0
- Upgraded from Excalidraw v0.16.1 to v0.17.0
- Applied the new styles of the buttons to Alkemio's ZoomToFit added button.


### Alkemio fork of Excalidraw v0.16.1

- Upgraded from Excalidraw v0.15.2 to v0.16.1

  - Sync master branch from github
  - `git pull`
  - Sync tags:

  ```
  $ git fetch --tags upstream
  ## Assuming upstream is already pointing to the excalidraw repo, if not, just run:
  $ git remote add upstream git@github.com:excalidraw/excalidraw.git
  ```

  - Checkout a new Branch pointing to the same commit as the tag:

  ```
  $ git checkout -b branch-v0.16.1 tags/v0.16.1
  ```

  - Push the new branch to GitHub and create the PR there or merge localy if there are conflicts

- Fixed merge conflicts and a small issue with the zoomToFit icon, they have added a function with the same name.

### Alkemio fork of Excalidraw v0.15.2

#### Modifications:

- ZoomToFit feature exposed through the external API
- Added ZoomToFit button to the zoom toolbar
- Added ZoomToFit flag to initialData to fit items on load

#### Development guidelines

- First of all, Excalidraw uses yarn as package manager, so first thing to do is make sure you have yarn installed in your system. `npm install --global yarn`.
- Clone the repository to a local folder: `git clone git@github.com:alkem-io/excalidraw.git` and create a feature branch to store your work.
- Follow the original Excalidraw instructions below to run and debug with the included test application - Just `yarn ; yarn start` should work.
- To test/debug Excalidraw inside our client-web application:
  - Execute `npm link` in the root of your cloned repository.
  - Go to your client-web folder and execute: `npm link @alkemio/excalidraw --save`
- When you're done with the development commit and push everything, create a Pull Request in the alkem-io/excalidraw repository to merge your branch to develop.
- Once is merged to `develop`, checkout `develop` branch and see below how to build and publish the package to NPM repository.
- Make sure you switch back the package in your client-web to use the published @alkemio/excalidraw package's new version instead of the old one or the linked one if you changed it.

#### Build and publish a new npm package:

```
yarn
cd src/packages/excalidraw
yarn install
yarn build:umd
yarn pack
yarn publish
```

<hr />


<a href="https://excalidraw.com/" target="_blank" rel="noopener">
  <picture>
    <source media="(prefers-color-scheme: dark)" alt="Excalidraw" srcset="https://excalidraw.nyc3.cdn.digitaloceanspaces.com/github/excalidraw_github_cover_2_dark.png" />
    <img alt="Excalidraw" src="https://excalidraw.nyc3.cdn.digitaloceanspaces.com/github/excalidraw_github_cover_2.png" />
  </picture>
</a>

<h4 align="center">
  <a href="https://excalidraw.com">Excalidraw Editor</a> |
  <a href="https://blog.excalidraw.com">Blog</a> |
  <a href="https://docs.excalidraw.com">Documentation</a> |
  <a href="https://plus.excalidraw.com">Excalidraw+</a>
</h4>

<div align="center">
  <h2>
    An open source virtual hand-drawn style whiteboard. </br>
    Collaborative and end-to-end encrypted. </br>
  <br />
  </h2>
</div>

<br />
<p align="center">
  <a href="https://github.com/excalidraw/excalidraw/blob/master/LICENSE">
    <img alt="Excalidraw is released under the MIT license." src="https://img.shields.io/badge/license-MIT-blue.svg"  />
  </a>
  <a href="https://www.npmjs.com/package/@excalidraw/excalidraw">
    <img alt="npm downloads/month" src="https://img.shields.io/npm/dm/@excalidraw/excalidraw"  />
  </a>
  <a href="https://docs.excalidraw.com/docs/introduction/contributing">
    <img alt="PRs welcome!" src="https://img.shields.io/badge/PRs-welcome-brightgreen.svg?style=flat"  />
  </a>
  <a href="https://discord.gg/UexuTaE">
    <img alt="Chat on Discord" src="https://img.shields.io/discord/723672430744174682?color=738ad6&label=Chat%20on%20Discord&logo=discord&logoColor=ffffff&widge=false"/>
  </a>
  <a href="https://deepwiki.com/excalidraw/excalidraw">
    <img alt="Ask DeepWiki" src="https://deepwiki.com/badge.svg" />
  </a>
  <a href="https://twitter.com/excalidraw">
    <img alt="Follow Excalidraw on Twitter" src="https://img.shields.io/twitter/follow/excalidraw.svg?label=follow+@excalidraw&style=social&logo=twitter"/>
  </a>
</p>

<div align="center">
  <figure>
    <a href="https://excalidraw.com" target="_blank" rel="noopener">
      <img src="https://excalidraw.nyc3.cdn.digitaloceanspaces.com/github%2Fproduct_showcase.png" alt="Product showcase" />
    </a>
    <figcaption>
      <p align="center">
        Create beautiful hand-drawn like diagrams, wireframes, or whatever you like.
      </p>
    </figcaption>
  </figure>
</div>

## Features

The Excalidraw editor (npm package) supports:

- 💯&nbsp;Free & open-source.
- 🎨&nbsp;Infinite, canvas-based whiteboard.
- ✍️&nbsp;Hand-drawn like style.
- 🌓&nbsp;Dark mode.
- 🏗️&nbsp;Customizable.
- 📷&nbsp;Image support.
- 😀&nbsp;Shape libraries support.
- 🌐&nbsp;Localization (i18n) support.
- 🖼️&nbsp;Export to PNG, SVG & clipboard.
- 💾&nbsp;Open format - export drawings as an `.excalidraw` json file.
- ⚒️&nbsp;Wide range of tools - rectangle, circle, diamond, arrow, line, free-draw, eraser...
- ➡️&nbsp;Arrow-binding & labeled arrows.
- 🔙&nbsp;Undo / Redo.
- 🔍&nbsp;Zoom and panning support.

## Excalidraw.com

The app hosted at [excalidraw.com](https://excalidraw.com) is a minimal showcase of what you can build with Excalidraw. Its [source code](https://github.com/excalidraw/excalidraw/tree/master/excalidraw-app) is part of this repository as well, and the app features:

- 📡&nbsp;PWA support (works offline).
- 🤼&nbsp;Real-time collaboration.
- 🔒&nbsp;End-to-end encryption.
- 💾&nbsp;Local-first support (autosaves to the browser).
- 🔗&nbsp;Shareable links (export to a readonly link you can share with others).

We'll be adding these features as drop-in plugins for the npm package in the future.

## Quick start

**Note:** following instructions are for installing the Excalidraw [npm package](https://www.npmjs.com/package/@excalidraw/excalidraw) when integrating Excalidraw into your own app. To run the repository locally for development, please refer to our [Development Guide](https://docs.excalidraw.com/docs/introduction/development).

```
npm install react react-dom @excalidraw/excalidraw
```

or via yarn

```
yarn add react react-dom @excalidraw/excalidraw
```

Check out our [documentation](https://docs.excalidraw.com/docs/@excalidraw/excalidraw/installation) for more details!

## Contributing

- Missing something or found a bug? [Report here](https://github.com/excalidraw/excalidraw/issues).
- Want to contribute? Check out our [contribution guide](https://docs.excalidraw.com/docs/introduction/contributing) or let us know on [Discord](https://discord.gg/UexuTaE).
- Want to help with translations? See the [translation guide](https://docs.excalidraw.com/docs/introduction/contributing#translating).

## Integrations

- [VScode extension](https://marketplace.visualstudio.com/items?itemName=pomdtr.excalidraw-editor)
- [npm package](https://www.npmjs.com/package/@excalidraw/excalidraw)

## Who's integrating Excalidraw

[Google Cloud](https://googlecloudcheatsheet.withgoogle.com/architecture) • [Meta](https://meta.com/) • [CodeSandbox](https://codesandbox.io/) • [Obsidian Excalidraw](https://github.com/zsviczian/obsidian-excalidraw-plugin) • [Replit](https://replit.com/) • [Slite](https://slite.com/) • [Notion](https://notion.so/) • [HackerRank](https://www.hackerrank.com/) • and many others

## Sponsors & support

If you like the project, you can become a sponsor at [Open Collective](https://opencollective.com/excalidraw) or use [Excalidraw+](https://plus.excalidraw.com/).

## Thank you for supporting Excalidraw

[<img src="https://opencollective.com/excalidraw/tiers/sponsors/0/avatar.svg?avatarHeight=120"/>](https://opencollective.com/excalidraw/tiers/sponsors/0/website) [<img src="https://opencollective.com/excalidraw/tiers/sponsors/1/avatar.svg?avatarHeight=120"/>](https://opencollective.com/excalidraw/tiers/sponsors/1/website) [<img src="https://opencollective.com/excalidraw/tiers/sponsors/2/avatar.svg?avatarHeight=120"/>](https://opencollective.com/excalidraw/tiers/sponsors/2/website) [<img src="https://opencollective.com/excalidraw/tiers/sponsors/3/avatar.svg?avatarHeight=120"/>](https://opencollective.com/excalidraw/tiers/sponsors/3/website) [<img src="https://opencollective.com/excalidraw/tiers/sponsors/4/avatar.svg?avatarHeight=120"/>](https://opencollective.com/excalidraw/tiers/sponsors/4/website) [<img src="https://opencollective.com/excalidraw/tiers/sponsors/5/avatar.svg?avatarHeight=120"/>](https://opencollective.com/excalidraw/tiers/sponsors/5/website) [<img src="https://opencollective.com/excalidraw/tiers/sponsors/6/avatar.svg?avatarHeight=120"/>](https://opencollective.com/excalidraw/tiers/sponsors/6/website) [<img src="https://opencollective.com/excalidraw/tiers/sponsors/7/avatar.svg?avatarHeight=120"/>](https://opencollective.com/excalidraw/tiers/sponsors/7/website) [<img src="https://opencollective.com/excalidraw/tiers/sponsors/8/avatar.svg?avatarHeight=120"/>](https://opencollective.com/excalidraw/tiers/sponsors/8/website) [<img src="https://opencollective.com/excalidraw/tiers/sponsors/9/avatar.svg?avatarHeight=120"/>](https://opencollective.com/excalidraw/tiers/sponsors/9/website) [<img src="https://opencollective.com/excalidraw/tiers/sponsors/10/avatar.svg?avatarHeight=120"/>](https://opencollective.com/excalidraw/tiers/sponsors/10/website)

<a href="https://opencollective.com/excalidraw#category-CONTRIBUTE" target="_blank"><img src="https://opencollective.com/excalidraw/tiers/backers.svg?avatarHeight=32"/></a>

Last but not least, we're thankful to these companies for offering their services for free:

[![Vercel](./.github/assets/vercel.svg)](https://vercel.com) [![Sentry](./.github/assets/sentry.svg)](https://sentry.io) [![Crowdin](./.github/assets/crowdin.svg)](https://crowdin.com)
