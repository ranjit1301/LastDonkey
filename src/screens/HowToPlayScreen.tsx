import React from 'react';
import { ArrowLeft } from 'lucide-react';
import { PlayingCard } from '../components/PlayingCard';
import { makeCard } from '../engine';

interface HowToPlayScreenProps {
  onBack: () => void;
  backLabel?: string;
}

const DEAL_TABLE = [
  { players: '2 Players', counts: '26, 26' },
  { players: '3 Players', counts: '18, 17, 17' },
  { players: '4 Players', counts: '13 each' },
  { players: '5 Players', counts: '11, 11, 10, 10, 10' },
  { players: '6 Players', counts: '9, 9, 9, 9, 8, 8' },
];

export const HowToPlayScreen: React.FC<HowToPlayScreenProps> = ({
  onBack,
  backLabel = 'Back',
}) => {
  return (
    <div className="min-h-screen cream-surface flex flex-col">
      <header className="w-full max-w-3xl mx-auto px-4 sm:px-6 pt-5 pb-4 flex items-center gap-3">
        <button
          type="button"
          onClick={onBack}
          className="min-h-[44px] px-3.5 rounded-full bg-[#EFE6D8] hover:bg-[#E5D9C6] inline-flex items-center gap-2 text-sm font-semibold text-[#261E18] transition-colors cursor-pointer"
        >
          <ArrowLeft className="w-4 h-4" />
          {backLabel}
        </button>
        <h1 className="font-display text-2xl sm:text-3xl font-bold text-[#261E18]">
          How to Play (Rang Vapas)
        </h1>
      </header>

      <main className="flex-1 w-full max-w-3xl mx-auto px-4 sm:px-6 pb-10 space-y-4">
        <section className="rounded-3xl bg-[#F4ECE0] border border-[#E2D6C4] p-5 sm:p-6">
          <h2 className="font-display text-lg font-bold text-[#D95732]">Objective</h2>
          <p className="mt-2 text-sm sm:text-base text-[#3A2E25] leading-relaxed">
            <strong>Last Donkey (Rang Vapas)</strong> is played with one standard 52-card deck (no
            jokers) for <strong>2 to 6 players</strong>. Empty your hand before everyone else—the
            last player remaining with cards after trick resolution becomes the{' '}
            <strong>Donkey</strong>.
          </p>
        </section>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <section className="rounded-3xl bg-[#F4ECE0] border border-[#E2D6C4] p-5">
            <h2 className="font-display text-lg font-bold text-[#261E18]">01. Dealing Cards</h2>
            <p className="mt-1.5 text-xs sm:text-sm text-[#5C4E41]">
              Extra cards always go to the first seats in clockwise order:
            </p>
            <div className="mt-3 divide-y divide-[#DFD3C1] text-sm tabular-nums">
              {DEAL_TABLE.map((row) => (
                <div key={row.players} className="py-2 flex items-center justify-between">
                  <span className="font-medium text-[#261E18]">{row.players}</span>
                  <span className="font-mono font-semibold text-[#365B40]">{row.counts}</span>
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-3xl bg-[#F4ECE0] border border-[#E2D6C4] p-5 flex flex-col justify-between">
            <div>
              <h2 className="font-display text-lg font-bold text-[#261E18]">
                02. Card Ranking &amp; A♠ Lead
              </h2>
              <div className="mt-2.5 p-2.5 rounded-xl bg-[#FAF5ED] border border-[#DFD3C1] font-mono text-xs text-[#D95732] font-bold text-center">
                A &gt; K &gt; Q &gt; J &gt; 10 &gt; 9 &gt; 8 &gt; 7 &gt; 6 &gt; 5 &gt; 4 &gt; 3 &gt; 2
              </div>
              <p className="mt-3 text-xs sm:text-sm text-[#3A2E25] leading-relaxed">
                The player holding <strong>A♠</strong> starts the game and must play{' '}
                <strong>A♠</strong> first. Turns move clockwise, skipping finished players.
              </p>
            </div>
            <div className="mt-3 flex justify-center">
              <PlayingCard card={makeCard('spades', 14)} size="sm" highlighted />
            </div>
          </section>
        </div>

        <section className="rounded-3xl bg-[#EBF4EE] border border-[#BDD7C5] p-5 sm:p-6">
          <h2 className="font-display text-lg font-bold text-[#1E4A2C]">
            03. Following Suit &amp; Successful Tricks
          </h2>
          <ul className="mt-2.5 space-y-2 text-sm text-[#24442E] list-disc pl-5 leading-relaxed">
            <li>You must follow the led suit if you hold at least one card of that suit.</li>
            <li>
              When every active player in the trick follows suit, all played cards are permanently
              removed from the game.
            </li>
            <li>
              <strong>Finishing happens ONLY after the trick resolves</strong>—multiple players can
              finish simultaneously on the same trick.
            </li>
            <li>
              The highest card of the led suit leads next (or the next-highest active led-suit
              player if that player finished).
            </li>
          </ul>
        </section>

        <section className="rounded-3xl bg-[#FDEEE9] border border-[#ECC1B3] p-5 sm:p-6">
          <h2 className="font-display text-lg font-bold text-[#9C2E12]">
            04. Failed Tricks — Off-Suit Cutting (Rang Vapas)
          </h2>
          <ul className="mt-2.5 space-y-2 text-sm text-[#5A2012] list-disc pl-5 leading-relaxed">
            <li>
              If a player has zero cards of the led suit and plays another suit (including on Trick
              1), the trick stops immediately—remaining players do not play.
            </li>
            <li>
              The player who played the <strong>highest card of the original led suit</strong>{' '}
              collects ALL cards played so far (including the off-suit card) and leads the next
              trick.
            </li>
            <li>
              <strong>No last-card protection:</strong> playing your final card does not make you
              safe if someone cuts your trick—if your card is the highest of the led suit, you
              collect all the cards and keep playing!
            </li>
            <li>
              The game ends only after a trick fully resolves and exactly one active player remains
              with cards.
            </li>
          </ul>
        </section>

        <section className="rounded-3xl bg-[#F4ECE0] border border-[#E2D6C4] p-5 sm:p-6">
          <h2 className="font-display text-lg font-bold text-[#261E18]">
            05. Turn Timer, Exits &amp; Multiplayer Rooms
          </h2>
          <ul className="mt-2.5 space-y-2 text-sm text-[#3A2E25] list-disc pl-5 leading-relaxed">
            <li>
              If your turn timer expires, a random legal card is played automatically. After{' '}
              <strong>3 consecutive missed turns</strong>, an absent player is removed and their
              cards are shuffled and distributed clockwise among remaining active players.
            </li>
            <li>
              Voluntary exit is disabled mid-trick and allowed between tricks (remaining cards are
              distributed clockwise).
            </li>
            <li>
              If a room host disconnects or leaves, the <strong>AI Room Host</strong> keeps the room
              running without pausing gameplay, and restores ownership if a disconnected host
              reconnects in time.
            </li>
          </ul>
        </section>
      </main>
    </div>
  );
};
