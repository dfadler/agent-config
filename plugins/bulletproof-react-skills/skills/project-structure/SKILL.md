---
name: project-structure
description: |
  Project structure conventions from bulletproof-react: what lives in src/,
  the app/assets/components/features/hooks/lib/stores/testing/types/utils
  layout, and how features are organized to stay unidirectional. Use when
  scaffolding a new React project or deciding where a new file belongs.
license: MIT
metadata:
  version: "0.1.0"
---

> Adapted from [bulletproof-react](https://github.com/alan2207/bulletproof-react) @ [`9506629`](https://github.com/alan2207/bulletproof-react/commit/9506629ed003a561c6627735480cce4994244bb4), MIT licensed. See ../../NOTICE.md for provenance and the re-pin workflow.

# 🗄️ Project Structure

Put most application code inside `src`, laid out like this:

```sh
src
|
+-- app               # application layer containing:
|   |                 # this folder might differ based on the meta framework used
|   +-- routes        # application routes / can also be pages
|   +-- app.tsx       # main application component
|   +-- provider.tsx  # application provider that wraps the entire application with different global providers - this might also differ based on meta framework used
|   +-- router.tsx    # application router configuration
+-- assets            # assets folder can contain all the static files such as images, fonts, etc.
|
+-- components        # shared components used across the entire application
|
+-- config            # global configurations, exported env variables etc.
|
+-- features          # feature based modules
|
+-- hooks             # shared hooks used across the entire application
|
+-- lib               # reusable libraries preconfigured for the application
|
+-- stores            # global state stores
|
+-- testing           # test utilities and mocks
|
+-- types             # shared types used across the application
|
+-- utils             # shared utility functions
```

Organize most of the code inside `features` rather than as a flat pile of files — when deciding where a new file belongs, default to putting it under its owning feature. Keeping feature-specific code separate from shared components makes the codebase easier to manage and improves collaboration, readability, and scalability compared to a flat structure.

Structure each feature like this:

```sh
src/features/awesome-feature
|
+-- api         # exported API request declarations and api hooks related to a specific feature
|
+-- assets      # assets folder can contain all the static files for a specific feature
|
+-- components  # components scoped to a specific feature
|
+-- hooks       # hooks scoped to a specific feature
|
+-- stores      # state stores for a specific feature
|
+-- types       # typescript types used within the feature
|
+-- utils       # utility functions for a specific feature
```

NOTE: Only create the subfolders a given feature actually needs — don't scaffold all of them by default.

If a lot of API calls are shared across features, put them in a dedicated top-level `api` folder instead of duplicating them inside each feature.

Avoid barrel files for exporting a feature's files — they defeat Vite's tree shaking and can cause performance issues. Import directly from the source file instead.

Never import across features. Compose features together only at the application level, so each feature stays independent and the codebase doesn't become tangled.

Enforce the no-cross-feature-import rule with ESLint:

```js
'import/no-restricted-paths': [
    'error',
    {
        zones: [
            // disables cross-feature imports:
            // eg. src/features/discussions should not import from src/features/comments, etc.
            {
                target: './src/features/auth',
                from: './src/features',
                except: ['./auth'],
            },
            {
                target: './src/features/comments',
                from: './src/features',
                except: ['./comments'],
            },
            {
                target: './src/features/discussions',
                from: './src/features',
                except: ['./discussions'],
            },
            {
                target: './src/features/teams',
                from: './src/features',
                except: ['./teams'],
            },
            {
                target: './src/features/users',
                from: './src/features',
                except: ['./users'],
            },

            // More restrictions...
        ],
    },
],
```

Enforce a unidirectional codebase architecture: code should flow one way, from shared parts to features to the app (shared -> features -> app). This keeps the codebase predictable and easier to understand.

![Unidirectional Codebase](https://raw.githubusercontent.com/alan2207/bulletproof-react/9506629ed003a561c6627735480cce4994244bb4/docs/assets/unidirectional-codebase.png)

Shared parts can be imported from anywhere in the codebase. Features may only import from shared parts. The app layer may import from both features and shared parts — never the reverse.

Enforce this direction with ESLint too:

```js
'import/no-restricted-paths': [
    'error',
    {
    zones: [
        // Previous restrictions...

        // enforce unidirectional codebase:
        // e.g. src/app can import from src/features but not the other way around
        {
            target: './src/features',
            from: './src/app',
        },

        // e.g src/features and src/app can import from these shared modules but not the other way around
        {
            target: [
                './src/components',
                './src/hooks',
                './src/lib',
                './src/types',
                './src/utils',
            ],
            from: ['./src/features', './src/app'],
        },
    ],
    },
],
```

Following these practices keeps the codebase organized, scalable, and maintainable, and the same architecture carries over cleanly to apps built with Next.js, Remix, or React Native.
