import Providers from "./providers";
import "./globals.css";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>{children}</Providers>
        <footer style={{textAlign: 'center', padding: '16px'}}>
          <a href="https://getsongbpm.com" style={{color: '#666', fontSize: '12px'}}>
            BPM data provided by GetSongBPM
          </a>
        </footer>
      </body>
    </html>
  );
}