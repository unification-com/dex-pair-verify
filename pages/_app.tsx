import { AppProps } from 'next/app';
import { SessionProvider } from 'next-auth/react';

// react-notifications base CSS MUST load before globals.css so our dark-toast
// `.notification-*` overrides (in globals.css) win.
import 'react-notifications/lib/notifications.css';
import '../styles/globals.css';

const App = ({ Component, pageProps }: AppProps) => {
  return (
      <SessionProvider session={pageProps.session}>
        <Component {...pageProps} />
      </SessionProvider>
  );
};

export default App;
