import type { Metadata, Viewport } from "next";
import "./globals.css";
import { AuthProvider } from "@/lib/auth";

// NOTE: we load Poppins via a plain <link> (not next/font) so the app does not
// require the native SWC binary — that binary keeps getting corrupted on some
// Windows machines after low-disk installs. With a .babelrc present, Next uses
// Babel and never touches SWC, and the fonts still load fine from a <link>.

export const metadata: Metadata = {
  title: "Golden Beach Restaurant · POS",
  description: "Point of sale — Golden Beach Restaurant, Midigama",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#f6990d",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
        {/* Map Poppins onto the --f-sans token the design system uses.
            No quotes around the font name — quotes get HTML-escaped differently
            on server vs client and trip React's hydration check. */}
        <style dangerouslySetInnerHTML={{ __html: ":root{--f-sans:Poppins,ui-sans-serif,system-ui,sans-serif;}" }} />
        {/* set theme before paint to avoid a flash */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('gb-theme')||'light';document.documentElement.setAttribute('data-theme',t);var a=localStorage.getItem('gb-accent');if(a&&/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(a)){document.documentElement.style.setProperty('--accent',a);var h=a.slice(1);if(h.length===3)h=h.replace(/(.)/g,'$1$1');var L=[0,2,4].map(function(i){var v=parseInt(h.substr(i,2),16)/255;return v<=0.03928?v/12.92:Math.pow((v+0.055)/1.055,2.4)});if(0.2126*L[0]+0.7152*L[1]+0.0722*L[2]>0.5)document.documentElement.setAttribute('data-accent-tone','light');}}catch(e){}})();`,
          }}
        />
      </head>
      <body>
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
