import { FolderOpen, Sparkles, ShieldCheck, Repeat, Boxes, WandSparkles } from 'lucide-react'
import { Button } from './ui'

export function Welcome({ onOpen, onSample }: { onOpen: () => void; onSample: () => void }) {
  return (
    <div className="welcome">
      <div className="welcome-card glass">
        <div className="w-logo">
          <WandSparkles size={30} />
        </div>
        <h1>Tidyset</h1>
        <p className="tag">
          The private, fully-offline data janitor. Clean, fix and reshape messy spreadsheets, with every
          change reviewable and reproducible. No cloud. No AI. No surprises.
        </p>

        <div className="w-actions">
          <Button variant="primary" onClick={onOpen}>
            <FolderOpen size={15} /> Open a file
          </Button>
          <Button variant="solid" onClick={onSample}>
            <Sparkles size={15} /> Try messy sample data
          </Button>
        </div>
        <div className="w-drop">or drop a CSV, TSV, Excel or JSON file anywhere</div>

        <div className="w-feats">
          <div className="feat">
            <ShieldCheck size={16} />
            <div>
              <b>100% offline</b>
              <span>Your data never leaves the machine.</span>
            </div>
          </div>
          <div className="feat">
            <Boxes size={16} />
            <div>
              <b>Cluster &amp; de-dupe</b>
              <span>Fix typos and merge near-duplicates.</span>
            </div>
          </div>
          <div className="feat">
            <Repeat size={16} />
            <div>
              <b>Reusable recipes</b>
              <span>Clean once, re-run on next month's file.</span>
            </div>
          </div>
        </div>
      </div>
      <style>{css}</style>
    </div>
  )
}

const css = `
.welcome { flex: 1; display: grid; place-items: center; padding: 24px; }
.welcome-card { border-radius: 26px; padding: 44px 48px; max-width: 560px; text-align: center; }
.w-logo {
  width: 62px; height: 62px; border-radius: 18px; margin: 0 auto 18px;
  background: linear-gradient(135deg, var(--accent), var(--accent-2));
  display: grid; place-items: center; color: #fff;
  box-shadow: 0 12px 34px var(--accent-glow);
}
.welcome h1 { font-size: 30px; font-weight: 760; letter-spacing: -0.03em; margin-bottom: 10px; }
.welcome .tag { font-size: 13.5px; color: var(--text-2); line-height: 1.6; max-width: 440px; margin: 0 auto 26px; }
.w-actions { display: flex; gap: 10px; justify-content: center; }
.w-actions .btn { padding: 10px 18px; font-size: 13.5px; }
.w-drop { font-size: 11.5px; color: var(--text-3); margin-top: 14px; }
.w-feats { display: grid; grid-template-columns: repeat(3,1fr); gap: 12px; margin-top: 32px; text-align: left; }
.feat { display: flex; gap: 9px; align-items: flex-start; }
.feat svg { color: var(--accent); flex-shrink: 0; margin-top: 2px; }
.feat b { display: block; font-size: 12px; font-weight: 640; }
.feat span { font-size: 11px; color: var(--text-3); line-height: 1.4; }
`
