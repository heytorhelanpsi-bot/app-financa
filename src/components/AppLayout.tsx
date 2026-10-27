import { useState, type ComponentType, type SVGProps } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import {
  IconBank,
  IconCalendar,
  IconCard,
  IconChart,
  IconHome,
  IconList,
  IconMore,
  IconPlus,
  IconQueue,
  IconSettings,
} from './icons';
import { OfflineBanner, SyncIndicator } from './SyncIndicator';
import { Logo } from './Logo';
import { Modal } from './ui';
import { useTxActions } from '@/features/transactions/TxActions';

interface NavItem {
  to: string;
  label: string;
  short: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  phase?: number;
}

export const NAV: NavItem[] = [
  { to: '/', label: 'Início', short: 'Início', icon: IconHome },
  { to: '/movimentacoes', label: 'Movimentações', short: 'Lançamentos', icon: IconList },
  { to: '/ordem-de-pagamento', label: 'Ordem de Pagamento', short: 'Ordem', icon: IconQueue, phase: 2 },
  { to: '/contas', label: 'Contas e Bancos', short: 'Contas', icon: IconBank },
  { to: '/cartoes', label: 'Cartões e Faturas', short: 'Cartões', icon: IconCard, phase: 3 },
  { to: '/calendario', label: 'Calendário', short: 'Calendário', icon: IconCalendar, phase: 3 },
  { to: '/relatorios', label: 'Relatórios', short: 'Relatórios', icon: IconChart, phase: 4 },
  { to: '/configuracoes', label: 'Configurações', short: 'Ajustes', icon: IconSettings },
];

const MOBILE_PRIMARY = ['/', '/movimentacoes', '/contas'];

function SideLink({ item, onClick }: { item: NavItem; onClick?: () => void }) {
  return (
    <NavLink
      to={item.to}
      end={item.to === '/'}
      onClick={onClick}
      className={({ isActive }) =>
        `group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition ${
          isActive ? 'bg-surface-2 text-fg' : 'text-muted hover:bg-surface-2/60 hover:text-fg'
        }`
      }
    >
      {({ isActive }) => (
        <>
          {isActive && (
            <span className="absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-full bg-accent glow-dot-accent" aria-hidden />
          )}
          <item.icon width={18} height={18} className={isActive ? 'text-accent' : ''} />
          <span className="flex-1">{item.label}</span>
          {item.phase && (
            <span className="rounded-md bg-surface-2 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-muted">
              Em breve
            </span>
          )}
        </>
      )}
    </NavLink>
  );
}

export function AppLayout() {
  const { openNew } = useTxActions();
  const [moreOpen, setMoreOpen] = useState(false);
  const location = useLocation();
  const moreActive = NAV.some((n) => !MOBILE_PRIMARY.includes(n.to) && n.to !== '/' && location.pathname.startsWith(n.to));

  return (
    <div className="min-h-dvh lg:flex">
      {/* Menu lateral (desktop) */}
      <aside className="sticky top-0 hidden h-dvh w-64 shrink-0 flex-col border-r border-line/60 px-4 py-6 lg:flex">
        <div className="mb-8 px-2">
          <Logo />
        </div>
        <button className="btn-primary mb-6 w-full" onClick={() => openNew('expense')}>
          <IconPlus width={18} height={18} /> Novo lançamento
        </button>
        <nav className="flex flex-1 flex-col gap-1" aria-label="Principal">
          {NAV.map((item) => (
            <SideLink key={item.to} item={item} />
          ))}
        </nav>
        <div className="px-2 pt-4">
          <SyncIndicator />
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex items-center justify-between border-b border-line/50 bg-bg/80 px-4 py-3 backdrop-blur-xl lg:hidden">
          <Logo />
          <SyncIndicator />
        </header>
        <OfflineBanner />
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 pb-32 pt-6 sm:px-6 lg:px-10 lg:pb-12 lg:pt-10">
          <Outlet />
        </main>
      </div>

      {/* Navegação inferior flutuante (celular) */}
      <nav className="fixed inset-x-3 bottom-3 z-30 lg:hidden" aria-label="Principal" style={{ marginBottom: 'env(safe-area-inset-bottom)' }}>
        <div className="grid grid-cols-5 items-center rounded-2xl border border-line/70 bg-surface/85 px-1 py-1.5 shadow-2xl backdrop-blur-xl">
          {NAV.filter((n) => MOBILE_PRIMARY.includes(n.to))
            .slice(0, 2)
            .map((item) => (
              <BottomLink key={item.to} item={item} />
            ))}
          <div className="flex justify-center">
            <button
              className="flex h-12 w-12 items-center justify-center rounded-2xl bg-accent text-[rgb(var(--accent-fg))] transition active:scale-95 dark:shadow-[0_0_0_1px_rgb(0_229_255/0.5),0_10px_30px_-8px_rgb(0_229_255/0.8)]"
              onClick={() => openNew('expense')}
              aria-label="Novo lançamento"
            >
              <IconPlus width={22} height={22} />
            </button>
          </div>
          <BottomLink item={NAV.find((n) => n.to === '/contas')!} />
          <button
            className={`flex flex-col items-center gap-1 py-1.5 text-[10px] font-medium ${moreActive ? 'text-accent' : 'text-muted'}`}
            onClick={() => setMoreOpen(true)}
          >
            <IconMore width={20} height={20} />
            Mais
          </button>
        </div>
      </nav>

      <Modal open={moreOpen} onClose={() => setMoreOpen(false)} title="Menu">
        <nav className="flex flex-col gap-1" aria-label="Mais opções">
          {NAV.filter((n) => !MOBILE_PRIMARY.includes(n.to)).map((item) => (
            <SideLink key={item.to} item={item} onClick={() => setMoreOpen(false)} />
          ))}
        </nav>
      </Modal>
    </div>
  );
}

function BottomLink({ item }: { item: NavItem }) {
  return (
    <NavLink
      to={item.to}
      end={item.to === '/'}
      className={({ isActive }) =>
        `flex flex-col items-center gap-1 py-1.5 text-[10px] font-medium transition ${isActive ? 'text-accent' : 'text-muted'}`
      }
    >
      <item.icon width={20} height={20} />
      {item.short}
    </NavLink>
  );
}
