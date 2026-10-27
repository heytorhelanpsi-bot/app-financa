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
import { Modal } from './ui';
import { useTxActions } from '@/features/transactions/TxActions';

interface NavItem {
  to: string;
  label: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  phase?: number;
}

export const NAV: NavItem[] = [
  { to: '/', label: 'Início', icon: IconHome },
  { to: '/movimentacoes', label: 'Movimentações', icon: IconList },
  { to: '/ordem-de-pagamento', label: 'Ordem de Pagamento', icon: IconQueue, phase: 2 },
  { to: '/contas', label: 'Contas e Bancos', icon: IconBank },
  { to: '/cartoes', label: 'Cartões e Faturas', icon: IconCard, phase: 3 },
  { to: '/calendario', label: 'Calendário', icon: IconCalendar, phase: 3 },
  { to: '/relatorios', label: 'Relatórios', icon: IconChart, phase: 4 },
  { to: '/configuracoes', label: 'Configurações', icon: IconSettings },
];

const MOBILE_PRIMARY = ['/', '/movimentacoes', '/contas'];

function linkClass({ isActive }: { isActive: boolean }) {
  return `flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition ${
    isActive ? 'bg-surface-2 text-fg' : 'text-muted hover:bg-surface-2 hover:text-fg'
  }`;
}

export function AppLayout() {
  const { openNew } = useTxActions();
  const [moreOpen, setMoreOpen] = useState(false);
  const location = useLocation();

  return (
    <div className="min-h-dvh lg:flex">
      {/* Menu lateral (desktop) */}
      <aside className="sticky top-0 hidden h-dvh w-64 shrink-0 flex-col border-r border-line bg-surface px-3 py-4 lg:flex">
        <div className="mb-6 flex items-center gap-2 px-3">
          <img src="/favicon.svg" alt="" className="h-7 w-7" />
          <span className="font-bold tracking-tight">Financeiro</span>
        </div>
        <button className="btn-primary mb-4" onClick={() => openNew('expense')}>
          <IconPlus /> Novo lançamento
        </button>
        <nav className="flex flex-1 flex-col gap-1" aria-label="Principal">
          {NAV.map((item) => (
            <NavLink key={item.to} to={item.to} end={item.to === '/'} className={linkClass}>
              <item.icon />
              <span className="flex-1">{item.label}</span>
              {item.phase && <span className="text-[10px] text-muted">Fase {item.phase}</span>}
            </NavLink>
          ))}
        </nav>
        <div className="px-3 pt-4">
          <SyncIndicator />
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex items-center justify-between border-b border-line bg-bg/90 px-4 py-3 backdrop-blur lg:hidden">
          <div className="flex items-center gap-2">
            <img src="/favicon.svg" alt="" className="h-6 w-6" />
            <span className="font-bold tracking-tight">Financeiro</span>
          </div>
          <SyncIndicator />
        </header>
        <OfflineBanner />
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 pb-28 pt-4 lg:px-8 lg:pb-10 lg:pt-8">
          <Outlet />
        </main>
      </div>

      {/* Navegação inferior (celular) */}
      <nav
        className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface/95 pb-safe backdrop-blur lg:hidden"
        aria-label="Principal"
      >
        <div className="grid grid-cols-5 items-center">
          {NAV.filter((n) => MOBILE_PRIMARY.includes(n.to))
            .slice(0, 2)
            .map((item) => (
              <BottomLink key={item.to} item={item} />
            ))}
          <div className="flex justify-center">
            <button
              className="-mt-6 flex h-14 w-14 items-center justify-center rounded-full bg-accent text-white shadow-lg dark:text-bg"
              onClick={() => openNew('expense')}
              aria-label="Novo lançamento"
            >
              <IconPlus width={26} height={26} />
            </button>
          </div>
          <BottomLink item={NAV.find((n) => n.to === '/contas')!} />
          <button
            className={`flex flex-col items-center gap-1 py-2 text-[11px] ${
              NAV.some((n) => !MOBILE_PRIMARY.includes(n.to) && location.pathname.startsWith(n.to) && n.to !== '/')
                ? 'text-fg'
                : 'text-muted'
            }`}
            onClick={() => setMoreOpen(true)}
          >
            <IconMore />
            Mais
          </button>
        </div>
      </nav>

      <Modal open={moreOpen} onClose={() => setMoreOpen(false)} title="Menu">
        <nav className="flex flex-col gap-1" aria-label="Mais opções">
          {NAV.filter((n) => !MOBILE_PRIMARY.includes(n.to)).map((item) => (
            <NavLink key={item.to} to={item.to} className={linkClass} onClick={() => setMoreOpen(false)}>
              <item.icon />
              <span className="flex-1">{item.label}</span>
              {item.phase && <span className="text-[10px] text-muted">Fase {item.phase}</span>}
            </NavLink>
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
        `flex flex-col items-center gap-1 py-2 text-[11px] ${isActive ? 'text-fg' : 'text-muted'}`
      }
    >
      <item.icon />
      {item.label.split(' ')[0]}
    </NavLink>
  );
}
