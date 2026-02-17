# CLAUDE.md

## Project Structure

Excalidraw is a **monorepo** with a clear separation between the core library and the application:

- **`packages/excalidraw/`** - Main React component library published to npm as `@excalidraw/excalidraw`
- **`excalidraw-app/`** - Full-featured web application (excalidraw.com) that uses the library
- **`packages/`** - Core packages: `@excalidraw/common`, `@excalidraw/element`, `@excalidraw/math`, `@excalidraw/utils`
- **`examples/`** - Integration examples (NextJS, browser script)

## Development Workflow

1. **Package Development**: Work in `packages/*` for editor features
2. **App Development**: Work in `excalidraw-app/` for app-specific features
3. **Testing**: Always run `yarn test:update` before committing
4. **Type Safety**: Use `yarn test:typecheck` to verify TypeScript

## Development Commands

```bash
yarn test:typecheck  # TypeScript type checking
yarn test:update     # Run all tests (with snapshot updates)
yarn fix             # Auto-fix formatting and linting issues
```

## Architecture Notes

### Package System

- Uses Yarn workspaces for monorepo management
- Internal packages use path aliases (see `vitest.config.mts`)
- Build system uses esbuild for packages, Vite for the app
- TypeScript throughout with strict configuration

## Excalidraw - Alkemio Fork

In this case, this is @alkemio/excalidraw, a fork of the original Excalidraw repository. Alkemio's custom version is as similar as possible to the original to avoid conflicts when updating from master.

### List of differences with standard Excalidraw

- Selected from a non-yet-released Excalidraw version that is already upgraded to React 19.
- Added ZoomToFit button to the zoom toolbar.
- Modified the paste functionality to avoid pasting elements (such as images) as JSON when editing text.
- Changed the toolbar Lock button behavior. Now it locks/unlocks elements instead of the tool in use.
- Changed the load from file behavior to fix multi-user collaboration bug. Now elements loaded will be inserted in the current scene instead of replacing all the elements of the scene.
- Added emoji insert tool.
- Added emoji realtime reaction broadcast tool.
- Added a shared broadcasted timer tool.

### Development process

Avoiding conflicts when merging from master is very important to us, Excalidraw is being actively developed and we are only adding some extra features:

- Try to make as few as possible modifications to the original files
- When adding features try to separate them as much as possible in new files
- When adding translations, add them only in the english file and at the end of the file unless it makes a lot of sense to insert them somewhere else
- Don't touch config files, don't upgrade packages, don't change the build process, always try to make customizations available from outside through the API rather than changing things inside the package
