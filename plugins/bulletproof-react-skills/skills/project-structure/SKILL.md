---
name: project-structure
description: |
  Project structure conventions from bulletproof-react: what lives in src/,
  the app/assets/components/features/hooks/lib/stores/testing/types/utils
  layout, and how features are organized to stay unidirectional. Use when
  scaffolding a new React project, deciding where a new file belongs, wiring
  up ESLint import restrictions, or answering "where should this go" /
  "should this feature import from that feature" questions.
license: MIT
metadata:
  version: "0.1.0"
---

> Adapted from [bulletproof-react](https://github.com/alan2207/bulletproof-react) @ [`9506629`](https://github.com/alan2207/bulletproof-react/commit/9506629ed003a561c6627735480cce4994244bb4), MIT licensed. See ../../NOTICE.md for provenance and the re-pin workflow.

# 🗄️ Project Structure

Put most application code under `src`, laid out like this:

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

Put most of the code inside `features`, not in flat shared folders — this is what keeps the codebase scalable and maintainable. Group each feature's own code together in its own feature folder rather than scattering it across shared component/hook/util directories; that separation is what makes the codebase easier to navigate, and what makes collaboration and scaling work as the app grows. A flat structure with everything mixed together is harder to manage as it grows.

Structure a feature folder like this:

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

Only create the subfolders a given feature actually needs — don't scaffold all of them by default.

If a lot of API calls are shared across features, pull them out of the individual feature folders into a dedicated top-level `api` folder instead of duplicating them per feature.

Don't reach for barrel files to re-export a feature's contents — import directly from the specific file instead. Barrel files used to be the recommendation, but they block Vite's tree shaking and can cause real performance regressions.

Never import one feature's internals from another feature — compose features together only at the application level. This keeps each feature independent and keeps the codebase from becoming tangled.

Enforce the no-cross-feature-import rule with ESLint rather than relying on code review to catch it:

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

Also enforce a unidirectional codebase architecture: make code flow in one direction, from shared parts to features to the app (shared -> features -> app). This is what keeps the codebase predictable and easy to reason about, instead of letting dependencies tangle in both directions.

![Unidirectional Codebase](https://raw.githubusercontent.com/alan2207/bulletproof-react/9506629ed003a561c6627735480cce4994244bb4/docs/assets/unidirectional-codebase.png)

Follow the direction shown above: shared parts can be imported from anywhere, features can only import from shared parts, and the app can import from both features and shared parts — never the other way around.

Enforce this with ESLint as well:

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

Follow these practices to keep the codebase organized, scalable, and maintainable, and to make collaboration more efficient. The same architecture carries over cleanly to apps built with Next.js, Remix, or React Native, so apply it there too.
