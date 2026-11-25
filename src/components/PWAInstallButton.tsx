import React, { useState } from 'react';
import { Download, Smartphone, X } from 'lucide-react';
import { usePWAInstall } from '../hooks/usePWAInstall';

interface PWAInstallButtonProps {
  variant?: 'header' | 'card';
}

export const PWAInstallButton: React.FC<PWAInstallButtonProps> = ({ variant = 'header' }) => {
  const { isInstallable, isInstalled, isIOS, isAndroid, install } = usePWAInstall();
  const [showGuide, setShowGuide] = useState(false);

  // Automatically suppress once running in standalone installed mode
  if (isInstalled) {
    return null;
  }

  const handleClick = async () => {
    if (isInstallable) {
      await install();
      return;
    }
    setShowGuide(true);
  };

  const buttonLabel = isInstallable
    ? 'Install App'
    : isIOS
      ? 'Install on iPhone'
      : 'Get Android App';

  return (
    <>
      {variant === 'header' ? (
        <button
          type="button"
          onClick={handleClick}
          className="min-h-[42px] px-3.5 sm:px-4 py-2 rounded-full bg-[#365B40] text-white shadow-sm text-xs sm:text-sm font-semibold hover:bg-[#2E4F37] transition-colors inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
        >
          <Download className="w-4 h-4 shrink-0" />
          <span>{buttonLabel}</span>
        </button>
      ) : (
        <div className="p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h2 className="text-sm sm:text-base font-bold text-[#261E18] flex items-center gap-2">
              <Smartphone className="w-4 h-4 text-[#365B40]" />
              Android &amp; Home Screen App
            </h2>
            <p className="mt-0.5 text-xs sm:text-sm text-[#6E6052]">
              Install Last Donkey full-screen on your phone for offline Practice vs Bots and Play
              Store packaging readiness.
            </p>
          </div>
          <button
            type="button"
            onClick={handleClick}
            className="min-h-[42px] px-4 py-2 rounded-xl bg-[#365B40] text-white text-xs font-bold hover:bg-[#2E4F37] transition-colors inline-flex items-center justify-center gap-1.5 cursor-pointer shrink-0 whitespace-nowrap"
          >
            <Download className="w-3.5 h-3.5" />
            {buttonLabel}
          </button>
        </div>
      )}

      {showGuide && (
        <div
          className="fixed inset-0 z-50 bg-black/55 backdrop-blur-[2px] flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="install-guide-title"
        >
          <div className="w-full max-w-md rounded-3xl bg-[#FAF5ED] text-[#261E18] border border-[#E2D6C4] p-6 shadow-2xl">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <div className="w-10 h-10 rounded-2xl bg-[#365B40] text-white flex items-center justify-center shrink-0">
                  <Smartphone className="w-5 h-5" />
                </div>
                <div>
                  <h3 id="install-guide-title" className="font-display text-xl font-bold">
                    {isIOS ? 'Install on iPhone / iPad' : 'Install on Android & Play Store'}
                  </h3>
                  <p className="text-xs text-[#6E6052]">
                    Last Donkey is ready as an installable mobile app (PWA)
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowGuide(false)}
                aria-label="Close install instructions"
                className="w-8 h-8 rounded-full bg-[#EFE6D8] text-[#3A2E25] flex items-center justify-center hover:bg-[#E4D7C3] cursor-pointer shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {isIOS ? (
              <ol className="mt-4 space-y-2.5 text-sm text-[#3A2E25] leading-relaxed list-decimal list-inside">
                <li>
                  Open this game URL in <strong>Safari</strong>.
                </li>
                <li>
                  Tap the <strong>Share</strong> icon in the bottom toolbar.
                </li>
                <li>
                  Scroll down and tap <strong>Add to Home Screen</strong>.
                </li>
              </ol>
            ) : (
              <div className="mt-4 space-y-4 text-sm text-[#3A2E25] leading-relaxed">
                <div className="rounded-2xl bg-[#EFE6D8] p-4">
                  <h4 className="font-bold text-[#261E18]">
                    1. Install directly on Android right now
                  </h4>
                  <p className="mt-1 text-xs sm:text-sm text-[#5C4E41]">
                    Open your shared game link in <strong>Google Chrome</strong> on Android, tap
                    the <strong>⋮ menu</strong> at the top-right, and choose{' '}
                    <strong>Install app</strong> (or <strong>Add to Home screen</strong>). It runs
                    full-screen like a native app and works offline for Practice vs Bots.
                  </p>
                  {!isAndroid && (
                    <p className="mt-1.5 text-xs text-[#6E6052]">
                      Tip: You can also open the app outside the preview frame in Chrome to trigger
                      the 1-tap Install button.
                    </p>
                  )}
                </div>

                <div className="rounded-2xl bg-[#EFE6D8] p-4">
                  <h4 className="font-bold text-[#261E18]">
                    2. Publish to Google Play Store (.aab)
                  </h4>
                  <p className="mt-1 text-xs sm:text-sm text-[#5C4E41]">
                    This app already includes a complete Web App Manifest, service worker, and
                    maskable Android icons. Once published to your live HTTPS URL, enter that URL
                    at <strong>pwabuilder.com</strong> (or use Google’s <strong>Bubblewrap</strong>{' '}
                    CLI) to generate a signed Android App Bundle (<code>.aab</code>) ready to
                    upload to Google Play Console.
                  </p>
                </div>
              </div>
            )}

            <button
              type="button"
              onClick={() => setShowGuide(false)}
              className="mt-5 w-full min-h-[46px] rounded-full btn-orange-3d font-bold text-sm cursor-pointer"
            >
              Got it
            </button>
          </div>
        </div>
      )}
    </>
  );
};
