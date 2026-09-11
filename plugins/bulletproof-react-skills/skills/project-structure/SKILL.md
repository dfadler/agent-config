---
name: project-structure
description: |
  Project structure conventions from bulletproof-react: what lives in src/,
  the app/assets/components/features/hooks/lib/stores/testing/types/utils
  layout, and how features are organized to stay unidirectional. Use when
  scaffolding a new React project, deciding where a new file belongs, reviewing
  a PR that imports across feature boundaries, or setting up ESLint import
  restrictions — for example "where should this component/hook/API call live",
  "should this be shared or feature-scoped", or "is this cross-feature import
  okay".
license: MIT
metadata:
  version: "0.1.0"
---

> Adapted from [bulletproof-react](https://github.com/alan2207/bulletproof-react) @ [`9506629`](https://github.com/alan2207/bulletproof-react/commit/9506629ed003a561c6627735480cce4994244bb4), MIT licensed. See ../../NOTICE.md for provenance and the re-pin workflow.

# 🗄️ Project Structure

Put most of the code in the `src` folder, laid out like this:

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

Organize most of the code within the `features` folder, not a flat structure — this keeps each feature's code together, prevents it from bleeding into shared components, and makes the codebase easier to manage, read, and scale as it grows.

Give a feature this structure:

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

NOTE: Only create the folders a feature actually needs — don't scaffold all of them by default.

If a lot of API calls are shared between features, put them in a dedicated top-level `api` folder instead of duplicating them per-feature.

Don't reach for barrel files to re-export a feature's contents — they break Vite's tree shaking and can cause performance issues. Import files directly instead.

Don't import across features. Compose different features together at the application level instead, so each feature stays independent and the codebase stays less convoluted.

To enforce this, add an ESLint rule forbidding cross-feature imports:

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

Also enforce a unidirectional codebase: code should flow one way, from shared parts to the application (shared -> features -> app). This keeps the codebase predictable and easier to reason about.

![Unidirectional Codebase](https://raw.githubusercontent.com/alan2207/bulletproof-react/9506629ed003a561c6627735480cce4994244bb4/docs/assets/unidirectional-codebase.png)

Shared parts can be used by any part of the codebase, but features can only import from shared parts, and the app can import from features and shared parts — never the reverse.

Enforce this with ESLint too:

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

Follow these practices to keep the codebase well-organized, scalable, and maintainable, and to work more efficiently with a team. The same architecture applies just as well to apps built with Next.js, Remix, or React Native.
