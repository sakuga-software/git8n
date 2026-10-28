import { startTransition, StrictMode } from 'react';
import { hydrateRoot } from 'react-dom/client';
import { HydratedRouter } from 'react-router/dom';

// `__DEMO__` is false in the build of the editor, and the bundler then drops the demo.
if (__DEMO__) {
  const { installDemo } = await import('./demo/install');

  installDemo();
}

startTransition(() => {
  hydrateRoot(
    document,
    <StrictMode>
      <HydratedRouter />
    </StrictMode>,
  );
});
