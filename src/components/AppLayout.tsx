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
  { to: '/ordem-de-pagamento', label: 'Ordem de Pagamento', short: 'Ordem', icon: IconQueue },
  { to: '/contas', label: 'Contas e Bancos', short: 'Contas', icon: IconBank },
  { to: '/cartoes', label: 'Cartões e Faturas', short: 'Cartões', icon: IconCard, phase: 3 },
  { to: '/calendario', label: 'Calendário', short: 'Calendário', icon: IconCalendar, phase: 3 },
  { to: '/relatorios', label: 'Relatórios', short: 'Relatórios', icon: IconChart, phase: 4 },
  { to: '/configuracoes', label: 'Configurações', short: 'Ajustes', icon: IconSettings },
];

const MOBILE_PRIMARY = ['/', '/movimentacoes', '/ordem-de-pagamento'];

function SideLink({ item, onClick }: { item: NavItem; onClick?: () => void }) {
  return (
    <NavLink
      to={item.to}
      end={item.to === '/'}
      onClick={onClick}
      className={({ isActive }) =>
        `group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition ${
          isActive ? 'bg-accent/10 text-fg' : 'text-muted hover:bg-surface-2/60 hover:text-fg'
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
      <aside className="glass sticky top-4 m-4 mr-0 hidden h-[calc(100dvh-2rem)] w-64 shrink-0 flex-col rounded-[2rem] px-4 py-6 lg:flex">
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
        <header className="glass sticky top-3 z-20 mx-3 mt-3 flex items-center justify-between rounded-full py-2 pl-2 pr-2.5 lg:hidden">
          <Logo />
          <SyncIndicator />
        </header>
        <OfflineBanner />
        <main key={location.pathname} className="animate-rise mx-auto w-full max-w-6xl flex-1 px-4 pb-32 pt-6 sm:px-6 lg:px-10 lg:pb-12 lg:pt-10">
          <Outlet />
        </main>
      </div>

      {/* Navegação inferior em pílula flutuante (celular) */}
      <nav
        className="fixed inset-x-0 bottom-4 z-30 flex justify-center px-4 lg:hidden"
        aria-label="Principal"
        style={{ marginBottom: 'env(safe-area-inset-bottom)' }}
      >
        <div className="glass-smoke flex items-center gap-1 rounded-full p-1.5">
          {NAV.filter((n) => MOBILE_PRIMARY.includes(n.to))
            .slice(0, 2)
            .map((item) => (
              <BottomLink key={item.to} item={item} />
            ))}
          <button
            className="mx-1 flex h-12 w-12 items-center justify-center rounded-full bg-sunset text-[#1e0f05] shadow-[0_8px_24px_-6px_rgba(234,97,19,0.9)] transition active:scale-95"
            onClick={() => openNew('expense')}
            aria-label="Novo lançamento"
            title="Novo lançamento"
          >
            <IconPlus width={22} height={22} />
          </button>
          <BottomLink item={NAV.find((n) => n.to === '/ordem-de-pagamento')!} />
          <button
            className={`flex h-12 w-12 items-center justify-center rounded-full transition ${
              moreActive ? 'bg-white/10 text-[#F88F22]' : 'text-[#a8988a] hover:text-white'
            }`}
            onClick={() => setMoreOpen(true)}
            aria-label="Mais opções"
            title="Mais opções"
          >
            <IconMore width={20} height={20} />
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
      aria-label={item.label}
      title={item.label}
      className={({ isActive }) =>
        `relative flex h-12 w-12 items-center justify-center rounded-full transition ${
          isActive ? 'bg-white/10 text-[#F88F22]' : 'text-[#a8988a] hover:text-white'
        }`
      }
    >
      {({ isActive }) => (
        <>
          <item.icon width={20} height={20} />
          {isActive && <span className="absolute bottom-1.5 h-1 w-1 rounded-full bg-[#F88F22] shadow-[0_0_8px_#F88F22]" aria-hidden />}
        </>
      )}
    </NavLink>
  );
}
