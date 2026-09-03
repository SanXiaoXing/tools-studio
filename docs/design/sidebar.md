You are given a task to integrate an existing React component in the codebase

The codebase should support:
- shadcn project structure
- Tailwind CSS
- Typescript

If it doesn't, provide instructions on how to setup project via shadcn CLI, install Tailwind or Typescript.

Determine the default path for components and styles.
If default path for components is not /components/ui, provide instructions on why it's important to create this folder
Copy-paste this component to /components/ui folder:
```tsx
sidebar-with-chrome-like-tabs.tsx
'use client';

import React, {
  useState,
  useRef,
  useCallback,
  useMemo,
  useContext,
  createContext,
  useEffect,
} from 'react';
import { motion, AnimatePresence, Reorder } from 'framer-motion';
import {
  X,
  Plus,
  PanelLeft,
  Menu,
  LucideIcon,
  MoreHorizontal,
  ChevronRight,
  ChevronLeft,
  Trash2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetTrigger,
  SheetTitle,
} from '@/components/ui/sheet';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from '@/components/ui/hover-card';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';

/**
 * Represents a navigation item in the sidebar.
 */
export interface NavItem {
  /** Unique identifier for the navigation item */
  id: string;
  /** Label text to display */
  label: string;
  /** Icon component to render */
  icon: LucideIcon;
}

/**
 * Represents a single browser-like tab.
 */
export interface Tab {
  /** Unique identifier for the tab */
  id: string;
  /** ID of the active navigation item within this tab */
  activeNavId: string;
}

/**
 * Props for the main SidebarWithTabs component.
 */
export interface SidebarWithTabsProps {
  /** Optional custom logo component */
  logo?: React.ReactNode;
  /** Name of the company/application */
  companyName?: string;
  /** List of navigation items */
  navItems: NavItem[];
  /** Function to render content based on the active navigation ID */
  renderContent: (navId: string) => React.ReactNode;
  /** ID of the default active navigation item */
  defaultNavId?: string;
  /** Optional footer content (e.g. user profile) */
  footer?: React.ReactNode;
}

interface TabsContextValue {
  tabs: Tab[];
  activeTabId: string;
  activeNavId: string;
  setActiveNav: (navId: string) => void;
  addTab: (navId?: string) => void;
  closeTab: (tabId: string) => void;
  closeOthers: (tabId: string) => void;
  closeToRight: (tabId: string) => void;
  closeToLeft: (tabId: string) => void;
  closeAll: () => void;
  setActiveTab: (tabId: string) => void;
}

const TabsContext = createContext<TabsContextValue | null>(null);

/**
 * Custom hook to access tab context.
 * Must be used within a SidebarWithTabs provider.
 */
export function useTabs() {
  const context = useContext(TabsContext);
  if (!context) {
    throw new Error('useTabs must be used within SidebarWithTabs');
  }
  return context;
}

/**
 * Individual tab component ensuring accessibility and animation.
 */
function ChromeTab({
  tab,
  isActive,
  isFirst,
  isLast,
  canClose,
  navItems,
  hasRightNeighborActive,
  onTabClick,
  onTabClose,
  onCloseOthers,
  onCloseToRight,
  onCloseToLeft,
  hasOtherTabs,
  hasTabsToRight,
  hasTabsToLeft,
}: {
  tab: Tab;
  isActive: boolean;
  isFirst: boolean;
  isLast: boolean;
  canClose: boolean;
  navItems: NavItem[];
  hasRightNeighborActive: boolean;
  onTabClick: () => void;
  onTabClose: () => void;
  onCloseOthers: () => void;
  onCloseToRight: () => void;
  onCloseToLeft: () => void;
  hasOtherTabs: boolean;
  hasTabsToRight: boolean;
  hasTabsToLeft: boolean;
}) {
  const nav = navItems.find((n) => n.id === tab.activeNavId);
  const Icon = nav?.icon;
  const label = nav?.label || 'New Tab';
  const tabRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isActive && tabRef.current) {
      // Standard scroll into view
      tabRef.current.scrollIntoView({
        behavior: 'smooth',
        block: 'nearest',
        inline: 'center',
      });

      if (isLast) {
        // Tiny timeout to let layout settle
        setTimeout(() => {
          const plusBtn = tabRef.current
            ?.closest('.flex')
            ?.querySelector('.new-tab-btn');
          if (plusBtn) {
            plusBtn.scrollIntoView({
              behavior: 'smooth',
              block: 'nearest',
              inline: 'center',
            });
          }
        }, 250);
      }
    }
  }, [isActive, isLast]);

  // Ensure active tab is centered on initial load (handling refresh)
  useEffect(() => {
    if (isActive && tabRef.current) {
      // Small delay to ensure layout is ready
      setTimeout(() => {
        tabRef.current?.scrollIntoView({
          behavior: 'auto',
          block: 'nearest',
          inline: 'center',
        });
      }, 200);
    }
  }, []);

  const handleAuxClick = (e: React.MouseEvent) => {
    if (e.button === 1 && canClose) {
      e.preventDefault();
      onTabClose();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onTabClick();
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      if (canClose) {
        e.preventDefault();
        onTabClose();
      }
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      const nextTab = (e.target as HTMLElement)
        .closest('li')
        ?.nextElementSibling?.querySelector('[role="tab"]') as HTMLElement;
      nextTab?.focus();
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      const prevTab = (e.target as HTMLElement)
        .closest('li')
        ?.previousElementSibling?.querySelector('[role="tab"]') as HTMLElement;
      prevTab?.focus();
    }
  };

  return (
    <ContextMenu>
      <ContextMenuTrigger>
        <div
          role='tab'
          aria-selected={isActive}
          tabIndex={isActive ? 0 : -1}
          className={cn(
            'relative flex items-center gap-2 px-4 py-2.5 ml-[10px] sm:ml-0 text-sm cursor-pointer active:cursor-grabbing transition-colors duration-150 min-w-[140px] max-w-[220px] outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring focus-visible:ring-offset-2 focus-visible:ring-offset-sidebar',
            isActive
              ? 'text-foreground'
              : 'text-muted-foreground hover:text-foreground'
          )}
          onClick={onTabClick}
          onAuxClick={handleAuxClick}
          onKeyDown={handleKeyDown}
          ref={tabRef}
        >
          {isActive && (
            <motion.div
              className='absolute inset-0 bg-background rounded-t-xl'
              layoutId='activeTabBg'
              transition={{ type: 'spring', bounce: 0.15, duration: 0.4 }}
            >
              <div
                className={cn(
                  'absolute -left-3 bottom-0 w-3 h-3 overflow-hidden'
                )}
              >
                <div className='absolute right-0 bottom-0 w-6 h-6 bg-sidebar rounded-full z-1' />
                <div className='absolute inset-0 bg-background' />
              </div>
              <div className='absolute -right-3 bottom-0 w-3 h-3 overflow-hidden'>
                <div className='absolute left-0 bottom-0 w-6 h-6 bg-sidebar rounded-full z-1' />
                <div className='absolute inset-0 bg-background' />
              </div>
            </motion.div>
          )}

          <div className='relative flex items-center gap-2 flex-1 min-w-0'>
            {Icon && <Icon className='h-4 w-4 flex-shrink-0' />}
            <span className='truncate flex-1 font-medium select-none'>
              {label}
            </span>

            {canClose && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onTabClose();
                }}
                className={cn(
                  'flex h-5 w-5 items-center justify-center rounded-full transition-colors flex-shrink-0',
                  isActive
                    ? 'hover:bg-muted text-muted-foreground hover:text-foreground'
                    : 'opacity-0 group-hover:opacity-100 hover:bg-sidebar-accent text-muted-foreground hover:text-sidebar-foreground'
                )}
              >
                <X className='h-3 w-3' />
              </button>
            )}
          </div>

          {!isActive && !hasRightNeighborActive && (
            <div className='absolute right-0 top-1/2 -translate-y-1/2 w-[1px] h-4 bg-sidebar-border' />
          )}
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent className='w-48'>
        <ContextMenuItem onClick={onTabClose} disabled={!canClose}>
          Close Tab
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onClick={onCloseOthers} disabled={!hasOtherTabs}>
          Close Other Tabs
        </ContextMenuItem>
        <ContextMenuItem onClick={onCloseToRight} disabled={!hasTabsToRight}>
          <ChevronRight className='mr-2 h-4 w-4' />
          Close Tabs to the Right
        </ContextMenuItem>
        <ContextMenuItem onClick={onCloseToLeft} disabled={!hasTabsToLeft}>
          <ChevronLeft className='mr-2 h-4 w-4' />
          Close Tabs to the Left
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

/**
 * Navigation items list component.
 */
function SidebarNavigation({
  navItems,
  activeNavId,
  isCollapsed,
  onItemClick,
}: {
  navItems: NavItem[];
  activeNavId: string;
  isCollapsed: boolean;
  onItemClick: (item: NavItem) => void;
}) {
  return (
    <nav className='space-y-1 px-3'>
      {navItems.map((item) => {
        const isActive = item.id === activeNavId;
        const NavButton = (
          <button
            key={item.id}
            onClick={() => onItemClick(item)}
            className={cn(
              'w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all duration-150 text-left relative',
              isActive
                ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                : 'text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
              isCollapsed && 'justify-center px-0'
            )}
          >
            <item.icon
              className={cn(
                'h-5 w-5 flex-shrink-0',
                isActive
                  ? 'text-sidebar-accent-foreground'
                  : 'text-muted-foreground'
              )}
            />
            <AnimatePresence>
              {!isCollapsed && (
                <AnimatePresence>
                  {!isCollapsed && (
                    <motion.span
                      initial={{ opacity: 0, width: 0 }}
                      animate={{ opacity: 1, width: 'auto' }}
                      exit={{ opacity: 0, width: 0 }}
                      transition={{
                        type: 'spring',
                        stiffness: 300,
                        damping: 30,
                      }}
                      className='font-medium text-sm whitespace-nowrap overflow-hidden'
                    >
                      {item.label}
                    </motion.span>
                  )}
                </AnimatePresence>
              )}
            </AnimatePresence>
            {isActive && !isCollapsed && (
              <motion.div
                layoutId='activeNavIndicator'
                className='absolute left-0 top-1/2 -translate-y-1/2 w-1 h-5 bg-sidebar-primary rounded-r-full'
                transition={{ type: 'spring', stiffness: 300, damping: 30 }}
              />
            )}
          </button>
        );

        if (isCollapsed) {
          return (
            <Tooltip key={item.id}>
              <TooltipTrigger asChild>{NavButton}</TooltipTrigger>
              <TooltipContent side='right' className='font-medium'>
                {item.label}
              </TooltipContent>
            </Tooltip>
          );
        }

        return NavButton;
      })}
    </nav>
  );
}

function MobileSidebar({
  logo,
  companyName,
  navItems,
  activeNavId,
  onItemClick,
}: {
  logo?: React.ReactNode;
  companyName: string;
  navItems: NavItem[];
  activeNavId: string;
  onItemClick: (item: NavItem) => void;
}) {
  const [open, setOpen] = useState(false);

  const handleItemClick = (item: NavItem) => {
    onItemClick(item);
    setOpen(false);
  };

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button
          variant='ghost'
          size='icon'
          className='h-9 w-9 text-muted-foreground hover:text-sidebar-foreground hover:bg-sidebar-accent flex-shrink-0'
        >
          <Menu className='h-5 w-5' />
        </Button>
      </SheetTrigger>
      <SheetContent side='left' className='w-72 p-0 border-r-0'>
        <SheetTitle className='sr-only'>Sidebar Navigation</SheetTitle>
        <div className='flex flex-col h-full bg-sidebar'>
          <div className='flex items-center gap-3 p-5 border-b border-sidebar-border'>
            {logo || (
              <div className='flex h-9 w-9 items-center justify-center rounded-xl bg-sidebar-primary'>
                <span className='text-sm font-bold text-sidebar-primary-foreground'>
                  A
                </span>
              </div>
            )}
            <span className='text-base font-bold text-sidebar-foreground'>
              {companyName}
            </span>
          </div>
          <div className='flex-1 py-4'>
            <SidebarNavigation
              navItems={navItems}
              activeNavId={activeNavId}
              isCollapsed={false}
              onItemClick={handleItemClick}
            />
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

/**
 * Button to add a new tab, supporting tap-to-add and hold-for-menu interactions.
 */
function NewTabButton({
  navItems,
  onAddTab,
}: {
  navItems: NavItem[];
  onAddTab: (navId?: string) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const isLongPress = useRef(false);
  const lastTouchTime = useRef(0);

  const handleTouchStart = () => {
    lastTouchTime.current = Date.now();
    isLongPress.current = false;
    timerRef.current = setTimeout(() => {
      isLongPress.current = true;
      setIsOpen(true);
    }, 500);
  };

  const handleTouchEnd = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  const handleClick = (e: React.MouseEvent) => {
    const isTouch = Date.now() - lastTouchTime.current < 1000;
    if (isTouch) {
      if (isLongPress.current) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      setIsOpen(false);
      onAddTab();
    } else {
      onAddTab();
    }
  };

  return (
    <HoverCard
      open={isOpen}
      onOpenChange={(open) => {
        // Prevent opening on touch interaction (simulated hover) unless it's a confirmed long press
        const isTouch = Date.now() - lastTouchTime.current < 1000;
        if (open && isTouch && !isLongPress.current) {
          return;
        }
        setIsOpen(open);
      }}
      openDelay={200}
      closeDelay={100}
    >
      <HoverCardTrigger asChild>
        <button
          onClick={handleClick}
          onTouchStart={handleTouchStart}
          onTouchEnd={handleTouchEnd}
          className='flex h-9 w-9 items-center justify-center text-muted-foreground transition-colors hover:text-foreground ml-1 mb-0.5 flex-shrink-0 new-tab-btn'
        >
          <Plus className='h-4 w-4' />
        </button>
      </HoverCardTrigger>
      <HoverCardContent
        align='start'
        className='w-48 p-1 bg-popover border-border'
        sideOffset={8}
      >
        <div className='text-xs text-muted-foreground px-2 py-1.5 font-medium'>
          Quick Open
        </div>
        {navItems.map((item) => (
          <button
            key={item.id}
            onClick={() => onAddTab(item.id)}
            className='w-full flex items-center gap-2 px-2 py-2 text-sm text-popover-foreground hover:bg-accent rounded-md transition-colors'
          >
            <item.icon className='h-4 w-4 text-muted-foreground' />
            <span>{item.label}</span>
          </button>
        ))}
      </HoverCardContent>
    </HoverCard>
  );
}

/**
 * Main Layout component featuring a sidebar and tabbed navigation.
 */
export function SidebarWithTabs({
  logo,
  companyName = 'Acme Inc',
  navItems,
  renderContent,
  defaultNavId,
  footer,
}: SidebarWithTabsProps) {
  const defaultNav = defaultNavId || navItems[0]?.id || '';
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [activeTabId, setActiveTabId] = useState('');
  const [isClient, setIsClient] = useState(false);
  const tabCounterRef = useRef(1);

  // Load state from localStorage on mount
  // Hydrate state from storage
  useEffect(() => {
    setIsClient(true);
    const savedState = localStorage.getItem('sidebar-tabs-state');

    if (savedState) {
      try {
        const { tabs: savedTabs, activeTabId: savedActiveId } =
          JSON.parse(savedState);
        setTabs(savedTabs);
        setActiveTabId(savedActiveId);

        // Sync tab counter
        const maxId = savedTabs.reduce((max: number, tab: Tab) => {
          const match = tab.id.match(/tab-(\d+)-/);
          return match ? Math.max(max, parseInt(match[1])) : max;
        }, 1);
        tabCounterRef.current = maxId;
      } catch (error) {
        console.error('State structure mismatch', error);
        // Reset to default on error
        setTabs([{ id: 'tab-1', activeNavId: defaultNav }]);
        setActiveTabId('tab-1');
      }
    } else {
      setTabs([{ id: 'tab-1', activeNavId: defaultNav }]);
      setActiveTabId('tab-1');
    }
  }, [defaultNav]);

  // Persist state efficiently
  useEffect(() => {
    if (!isClient || tabs.length === 0) return;

    const handler = setTimeout(() => {
      localStorage.setItem(
        'sidebar-tabs-state',
        JSON.stringify({ tabs, activeTabId })
      );
    }, 500); // Debounce to prevent heavy writes

    return () => clearTimeout(handler);
  }, [tabs, activeTabId, isClient]);

  useEffect(() => {
    if (isClient && tabs.length === 0) {
      setTabs([{ id: 'tab-1', activeNavId: defaultNav }]);
      setActiveTabId('tab-1');
    }
  }, [isClient, tabs.length, defaultNav]);

  const activeTab = tabs.find((t) => t.id === activeTabId);
  const activeNavId = activeTab?.activeNavId || defaultNav;
  const activeTabIndex = tabs.findIndex((t) => t.id === activeTabId);

  const setActiveNav = useCallback(
    (navId: string) => {
      setTabs((prev) =>
        prev.map((tab) =>
          tab.id === activeTabId ? { ...tab, activeNavId: navId } : tab
        )
      );
    },
    [activeTabId]
  );

  const addTab = useCallback(
    (navId?: string) => {
      tabCounterRef.current += 1;
      const newTabId = `tab-${tabCounterRef.current}-${Date.now()}`;
      const newTab: Tab = {
        id: newTabId,
        activeNavId: navId || defaultNav,
      };
      setTabs((prev) => [...prev, newTab]);
      setActiveTabId(newTabId);
    },
    [defaultNav]
  );

  const closeTab = useCallback(
    (tabId: string) => {
      if (tabs.length === 1) return;
      const tabIndex = tabs.findIndex((t) => t.id === tabId);
      const newTabs = tabs.filter((t) => t.id !== tabId);
      setTabs(newTabs);

      if (activeTabId === tabId) {
        // Select the next tab (right) if available, otherwise the previous (left)
        const newActiveIndex =
          tabIndex === newTabs.length ? tabIndex - 1 : tabIndex;
        // Ensure we have a valid index
        const safeIndex = Math.max(0, newActiveIndex);
        if (newTabs[safeIndex]) {
          setActiveTabId(newTabs[safeIndex].id);
        } else {
          // Fallback if no tabs left (shouldn't happen due to guard)
        }
      }
    },
    [tabs, activeTabId]
  );

  const closeOthers = useCallback((tabId: string) => {
    setTabs((prev) => prev.filter((t) => t.id === tabId));
    setActiveTabId(tabId);
  }, []);

  const closeToRight = useCallback(
    (tabId: string) => {
      const index = tabs.findIndex((t) => t.id === tabId);
      const newTabs = tabs.slice(0, index + 1);
      setTabs(newTabs);
      if (!newTabs.find((t) => t.id === activeTabId)) {
        setActiveTabId(tabId);
      }
    },
    [tabs, activeTabId]
  );

  const closeToLeft = useCallback(
    (tabId: string) => {
      const index = tabs.findIndex((t) => t.id === tabId);
      const newTabs = tabs.slice(index);
      setTabs(newTabs);
      if (!newTabs.find((t) => t.id === activeTabId)) {
        setActiveTabId(tabId);
      }
    },
    [tabs, activeTabId]
  );

  const closeAll = useCallback(() => {
    if (tabs.length <= 1) return;
    const firstTab = tabs[0];
    setTabs([firstTab]);
    setActiveTabId(firstTab.id);
  }, [tabs]);

  const setActiveTab = useCallback((tabId: string) => {
    setActiveTabId(tabId);
  }, []);

  const handleNavItemClick = useCallback(
    (item: NavItem) => {
      setActiveNav(item.id);
    },
    [setActiveNav]
  );

  const contextValue = useMemo(
    () => ({
      tabs,
      activeTabId,
      activeNavId,
      setActiveNav,
      addTab,
      closeTab,
      closeOthers,
      closeToRight,
      closeToLeft,
      closeAll,
      setActiveTab,
    }),
    [
      tabs,
      activeTabId,
      activeNavId,
      setActiveNav,
      addTab,
      closeTab,
      closeOthers,
      closeToRight,
      closeToLeft,
      closeAll,
      setActiveTab,
    ]
  );

  const canCloseTab = tabs.length > 1;
  const hasOtherTabs = tabs.length > 1;

  return (
    <TooltipProvider delayDuration={0}>
      <TabsContext.Provider value={contextValue}>
        <div className='flex h-screen w-full bg-sidebar overflow-hidden'>
          <motion.aside
            initial={false}
            animate={{ width: isCollapsed ? 64 : 240 }}
            transition={{ type: 'spring', stiffness: 300, damping: 30 }}
            className='hidden md:flex flex-col bg-sidebar overflow-hidden'
          >
            <div className='flex flex-col h-full overflow-hidden'>
              <div
                className={cn(
                  'flex items-center h-[52px] px-4 border-b border-sidebar-border',
                  isCollapsed ? 'justify-center' : 'justify-between'
                )}
              >
                <div className='flex items-center gap-3 min-w-0'>
                  {logo || (
                    <div className='flex h-8 w-8 items-center justify-center rounded-lg bg-sidebar-primary flex-shrink-0'>
                      <span className='text-sm font-bold text-sidebar-primary-foreground'>
                        A
                      </span>
                    </div>
                  )}
                  <AnimatePresence>
                    {!isCollapsed && (
                      <motion.span
                        initial={{ opacity: 0, width: 0 }}
                        animate={{ opacity: 1, width: 'auto' }}
                        exit={{ opacity: 0, width: 0 }}
                        transition={{
                          type: 'spring',
                          stiffness: 300,
                          damping: 30,
                        }}
                        className='text-sm font-bold text-sidebar-foreground truncate tracking-tight whitespace-nowrap ml-3'
                      >
                        {companyName}
                      </motion.span>
                    )}
                  </AnimatePresence>
                </div>
                {!isCollapsed && (
                  <Button
                    variant='ghost'
                    size='icon'
                    onClick={() => setIsCollapsed(!isCollapsed)}
                    className='h-8 w-8 text-muted-foreground hover:text-sidebar-foreground hover:bg-sidebar-accent flex-shrink-0'
                  >
                    <PanelLeft className='h-4 w-4' />
                  </Button>
                )}
              </div>

              {isCollapsed && (
                <div className='flex justify-center py-2 border-b border-sidebar-border'>
                  <Button
                    variant='ghost'
                    size='icon'
                    onClick={() => setIsCollapsed(!isCollapsed)}
                    className='h-8 w-8 text-muted-foreground hover:text-sidebar-foreground hover:bg-sidebar-accent flex-shrink-0'
                  >
                    <PanelLeft className='h-4 w-4 rotate-180' />
                  </Button>
                </div>
              )}

              <div className='flex-1 py-4 overflow-y-auto scrollbar-hide'>
                <SidebarNavigation
                  navItems={navItems}
                  activeNavId={activeNavId}
                  isCollapsed={isCollapsed}
                  onItemClick={handleNavItemClick}
                />
              </div>

              <div className='p-4 border-t border-sidebar-border h-[73px] flex items-center justify-center overflow-hidden'>
                <AnimatePresence mode='wait'>
                  {!isCollapsed ? (
                    footer ? (
                      <motion.div
                        key='expanded'
                        initial={{ opacity: 0, x: -10 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: -10 }}
                        transition={{
                          type: 'spring',
                          stiffness: 300,
                          damping: 30,
                        }}
                        className='w-full'
                      >
                        {footer}
                      </motion.div>
                    ) : null
                  ) : (
                    <motion.div
                      key='collapsed'
                      initial={{ opacity: 0, scale: 0.8 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.8 }}
                      transition={{
                        type: 'spring',
                        stiffness: 300,
                        damping: 30,
                      }}
                      className='flex justify-center'
                    >
                      {logo || (
                        <div className='w-8 h-8 rounded-full bg-muted flex-shrink-0' />
                      )}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </div>
          </motion.aside>

          <div className='flex flex-1 flex-col overflow-hidden relative'>
            <div className='flex items-end bg-sidebar pt-2'>
              <div className='md:hidden flex-shrink-0 self-center ml-2'>
                <MobileSidebar
                  logo={logo}
                  companyName={companyName}
                  navItems={navItems}
                  activeNavId={activeNavId}
                  onItemClick={handleNavItemClick}
                />
              </div>

              <div
                className='flex items-end overflow-x-auto scrollbar-hide flex-1'
                style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
              >
                <Reorder.Group
                  as='ol'
                  axis='x'
                  values={tabs}
                  onReorder={setTabs}
                  className='flex items-end'
                  role='tablist'
                >
                  <AnimatePresence initial={false}>
                    {tabs.map((tab, index) => {
                      const isActive = tab.id === activeTabId;
                      const isFirst = index === 0;
                      const isLast = index === tabs.length - 1;
                      const hasRightNeighborActive =
                        index < tabs.length - 1 &&
                        tabs[index + 1].id === activeTabId;

                      return (
                        <Reorder.Item
                          value={tab}
                          as='li'
                          layout
                          key={tab.id}
                          initial={{ opacity: 0, width: 0 }}
                          animate={{ opacity: 1, width: 'auto' }}
                          exit={{ opacity: 0, width: 0 }}
                          whileDrag={{ cursor: 'grabbing' }}
                          transition={{ duration: 0.2, ease: [0.4, 0, 0.2, 1] }}
                          className='relative group flex-shrink-0'
                          style={{ zIndex: isActive ? 10 : 1 }}
                        >
                          <ChromeTab
                            tab={tab}
                            isActive={isActive}
                            isFirst={isFirst}
                            isLast={isLast}
                            canClose={canCloseTab}
                            navItems={navItems}
                            hasRightNeighborActive={hasRightNeighborActive}
                            onTabClick={() => setActiveTab(tab.id)}
                            onTabClose={() => closeTab(tab.id)}
                            onCloseOthers={() => closeOthers(tab.id)}
                            onCloseToRight={() => closeToRight(tab.id)}
                            onCloseToLeft={() => closeToLeft(tab.id)}
                            hasOtherTabs={hasOtherTabs}
                            hasTabsToRight={index < tabs.length - 1}
                            hasTabsToLeft={index > 0}
                          />
                        </Reorder.Item>
                      );
                    })}
                  </AnimatePresence>
                </Reorder.Group>

                <motion.div layout className='flex-shrink-0'>
                  <NewTabButton navItems={navItems} onAddTab={addTab} />
                </motion.div>
              </div>

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button className='flex h-9 w-9 items-center justify-center text-muted-foreground transition-colors hover:text-foreground hover:bg-sidebar-accent rounded-lg mr-2 mb-0.5 flex-shrink-0'>
                    <MoreHorizontal className='h-5 w-5' />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align='end' className='w-48'>
                  <DropdownMenuItem onClick={() => addTab()}>
                    <Plus className='mr-2 h-4 w-4' />
                    New Tab
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onClick={closeAll}
                    disabled={!hasOtherTabs}
                    className={cn(
                      hasOtherTabs && 'text-red-500 focus:text-red-500'
                    )}
                  >
                    <Trash2 className='mr-2 h-4 w-4' />
                    Close All Tabs
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>

            <main className='flex-1 overflow-hidden bg-sidebar p-0 md:pr-3 md:pb-3'>
              <div
                className={cn(
                  'h-full bg-background overflow-auto transition-all duration-300 ease-in-out',
                  'md:rounded-br-3xl md:rounded-bl-3xl md:rounded-tr-3xl',
                  activeTabIndex !== 0 && 'md:rounded-tl-3xl'
                )}
              >
                <AnimatePresence mode='wait'>
                  <motion.div
                    key={`${activeTabId}-${activeNavId}`}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.15 }}
                    className='h-full'
                  >
                    {renderContent(activeNavId)}
                  </motion.div>
                </AnimatePresence>
              </div>
            </main>
          </div>
        </div>
      </TabsContext.Provider>
    </TooltipProvider>
  );
}


demo.tsx
'use client';

import * as React from 'react';
import { Home, FileText, Settings, Users, LayoutGrid } from 'lucide-react';
import { SidebarWithTabs, NavItem } from '@/components/ui/sidebar-with-chrome-like-tabs';

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';

const navItems: NavItem[] = [
  { id: 'dashboard', label: 'Dashboard', icon: Home },
  { id: 'documents', label: 'Documents', icon: FileText },
  { id: 'team', label: 'Team', icon: Users },
  { id: 'projects', label: 'Projects', icon: LayoutGrid },
  { id: 'settings', label: 'Settings', icon: Settings },
];

function DashboardContent() {
  return (
    <div className='p-6'>
      <h1 className='text-xl font-semibold text-stone-800 dark:text-stone-100'>
        Dashboard
      </h1>
      <p className='text-stone-500 dark:text-stone-400 mt-1'>
        Welcome to your dashboard
      </p>
    </div>
  );
}

function DocumentsContent() {
  return (
    <div className='p-6'>
      <h1 className='text-xl font-semibold text-stone-800 dark:text-stone-100'>
        Documents
      </h1>
      <p className='text-stone-500 dark:text-stone-400 mt-1'>
        Manage your documents
      </p>
    </div>
  );
}

function TeamContent() {
  return (
    <div className='p-6'>
      <h1 className='text-xl font-semibold text-stone-800 dark:text-stone-100'>
        Team
      </h1>
      <p className='text-stone-500 dark:text-stone-400 mt-1'>
        Manage your team members
      </p>
    </div>
  );
}

function ProjectsContent() {
  return (
    <div className='p-6'>
      <h1 className='text-xl font-semibold text-stone-800 dark:text-stone-100'>
        Projects
      </h1>
      <p className='text-stone-500 dark:text-stone-400 mt-1'>
        Manage your projects
      </p>
    </div>
  );
}

function SettingsContent() {
  return (
    <div className='p-6'>
      <h1 className='text-xl font-semibold text-stone-800 dark:text-stone-100'>
        Settings
      </h1>
      <p className='text-stone-500 dark:text-stone-400 mt-1'>
        Manage your settings
      </p>
    </div>
  );
}

const contentMap: Record<string, React.ReactNode> = {
  dashboard: <DashboardContent />,
  documents: <DocumentsContent />,
  team: <TeamContent />,
  projects: <ProjectsContent />,
  settings: <SettingsContent />,
};

export default function HomePage() {
  const renderContent = (navId: string) => {
    return contentMap[navId] || <DashboardContent />;
  };

  return (
    <SidebarWithTabs
      companyName='Acme Inc'
      navItems={navItems}
      renderContent={renderContent}
      defaultNavId='dashboard'
      footer={
        <div className='flex items-center gap-3 px-3 py-2 rounded-lg bg-sidebar-accent w-full'>
          <Avatar>
            <AvatarImage
              src='https://cdn.21st.dev/assets/mirror/cf/cf584ee772c86d215d79d167b1dd9c273489838c0315e2a795d77dd089808f71.jpg'
              alt='@Arunachalam0606'
              className='object-cover'
            />
            <AvatarFallback>UA</AvatarFallback>
          </Avatar>
          <div className='min-w-0 flex-1 overflow-hidden'>
            <p className='text-xs font-medium text-sidebar-foreground truncate whitespace-nowrap'>
              User Account
            </p>
            <p className='text-[10px] text-muted-foreground truncate whitespace-nowrap'>
              Pro Plan
            </p>
          </div>
        </div>
      }
    />
  );
}

```

Copy-paste these files for dependencies:
```tsx
shadcn/button
import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/90",
        destructive:
          "bg-destructive text-destructive-foreground hover:bg-destructive/90",
        outline:
          "border border-input bg-background hover:bg-accent hover:text-accent-foreground",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-secondary/80",
        ghost: "hover:bg-accent hover:text-accent-foreground",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-10 px-4 py-2",
        sm: "h-9 rounded-md px-3",
        lg: "h-11 rounded-md px-8",
        icon: "h-10 w-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button"
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    )
  },
)
Button.displayName = "Button"

export { Button, buttonVariants }

```
```tsx
shadcn/sheet
"use client"

import * as React from "react"
import * as SheetPrimitive from "@radix-ui/react-dialog"
import { cva, type VariantProps } from "class-variance-authority"
import { X } from "lucide-react"

import { cn } from "@/lib/utils"

const Sheet = SheetPrimitive.Root

const SheetTrigger = SheetPrimitive.Trigger

const SheetClose = SheetPrimitive.Close

const SheetPortal = SheetPrimitive.Portal

const SheetOverlay = React.forwardRef<
  React.ElementRef<typeof SheetPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof SheetPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <SheetPrimitive.Overlay
    className={cn(
      "fixed inset-0 z-50 bg-black/80  data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
      className,
    )}
    {...props}
    ref={ref}
  />
))
SheetOverlay.displayName = SheetPrimitive.Overlay.displayName

const sheetVariants = cva(
  "fixed z-50 gap-4 bg-background p-6 shadow-lg transition ease-in-out data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:duration-300 data-[state=open]:duration-500",
  {
    variants: {
      side: {
        top: "inset-x-0 top-0 border-b data-[state=closed]:slide-out-to-top data-[state=open]:slide-in-from-top",
        bottom:
          "inset-x-0 bottom-0 border-t data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-bottom",
        left: "inset-y-0 left-0 h-full w-3/4 border-r data-[state=closed]:slide-out-to-left data-[state=open]:slide-in-from-left sm:max-w-sm",
        right:
          "inset-y-0 right-0 h-full w-3/4  border-l data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right sm:max-w-sm",
      },
    },
    defaultVariants: {
      side: "right",
    },
  },
)

interface SheetContentProps
  extends React.ComponentPropsWithoutRef<typeof SheetPrimitive.Content>,
    VariantProps<typeof sheetVariants> {}

const SheetContent = React.forwardRef<
  React.ElementRef<typeof SheetPrimitive.Content>,
  SheetContentProps
>(({ side = "right", className, children, ...props }, ref) => (
  <SheetPortal>
    <SheetOverlay />
    <SheetPrimitive.Content
      ref={ref}
      className={cn(sheetVariants({ side }), className)}
      {...props}
    >
      {children}
      <SheetPrimitive.Close className="absolute right-4 top-4 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none data-[state=open]:bg-secondary">
        <X className="h-4 w-4" />
        <span className="sr-only">Close</span>
      </SheetPrimitive.Close>
    </SheetPrimitive.Content>
  </SheetPortal>
))
SheetContent.displayName = SheetPrimitive.Content.displayName

const SheetHeader = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      "flex flex-col space-y-2 text-center sm:text-left",
      className,
    )}
    {...props}
  />
)
SheetHeader.displayName = "SheetHeader"

const SheetFooter = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      "flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2",
      className,
    )}
    {...props}
  />
)
SheetFooter.displayName = "SheetFooter"

const SheetTitle = React.forwardRef<
  React.ElementRef<typeof SheetPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof SheetPrimitive.Title>
>(({ className, ...props }, ref) => (
  <SheetPrimitive.Title
    ref={ref}
    className={cn("text-lg font-semibold text-foreground", className)}
    {...props}
  />
))
SheetTitle.displayName = SheetPrimitive.Title.displayName

const SheetDescription = React.forwardRef<
  React.ElementRef<typeof SheetPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof SheetPrimitive.Description>
>(({ className, ...props }, ref) => (
  <SheetPrimitive.Description
    ref={ref}
    className={cn("text-sm text-muted-foreground", className)}
    {...props}
  />
))
SheetDescription.displayName = SheetPrimitive.Description.displayName

export {
  Sheet,
  SheetPortal,
  SheetOverlay,
  SheetTrigger,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetFooter,
  SheetTitle,
  SheetDescription,
}

```
```tsx
shadcn/input
import * as React from "react"

import { cn } from "@/lib/utils"

export interface InputProps
  extends React.InputHTMLAttributes<HTMLInputElement> {}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
          className
        )}
        ref={ref}
        {...props}
      />
    )
  }
)
Input.displayName = "Input"

export { Input }

```
```tsx
shadcn/label
"use client"

import * as React from "react"
import * as LabelPrimitive from "@radix-ui/react-label"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const labelVariants = cva(
  "text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70",
)

const Label = React.forwardRef<
  React.ElementRef<typeof LabelPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof LabelPrimitive.Root> &
    VariantProps<typeof labelVariants>
>(({ className, ...props }, ref) => (
  <LabelPrimitive.Root
    ref={ref}
    className={cn(labelVariants(), className)}
    {...props}
  />
))
Label.displayName = LabelPrimitive.Root.displayName

export { Label }

```
```tsx
shadcn/tooltip
"use client"

import * as React from "react"
import * as TooltipPrimitive from "@radix-ui/react-tooltip"

import { cn } from "@/lib/utils"

const TooltipProvider = TooltipPrimitive.Provider

const Tooltip = TooltipPrimitive.Root

const TooltipTrigger = TooltipPrimitive.Trigger

const TooltipContent = React.forwardRef<
  React.ElementRef<typeof TooltipPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Content>
>(({ className, sideOffset = 4, ...props }, ref) => (
  <TooltipPrimitive.Content
    ref={ref}
    sideOffset={sideOffset}
    className={cn(
      "z-50 overflow-hidden rounded-md border bg-popover px-3 py-1.5 text-sm text-popover-foreground shadow-md animate-in fade-in-0 zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2",
      className,
    )}
    {...props}
  />
))
TooltipContent.displayName = TooltipPrimitive.Content.displayName

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider }

```
```tsx
shadcn/context-menu
"use client"

import * as React from "react"
import * as ContextMenuPrimitive from "@radix-ui/react-context-menu"
import { Check, ChevronRight, Circle } from "lucide-react"

import { cn } from "@/lib/utils"

const ContextMenu = ContextMenuPrimitive.Root

const ContextMenuTrigger = ContextMenuPrimitive.Trigger

const ContextMenuGroup = ContextMenuPrimitive.Group

const ContextMenuPortal = ContextMenuPrimitive.Portal

const ContextMenuSub = ContextMenuPrimitive.Sub

const ContextMenuRadioGroup = ContextMenuPrimitive.RadioGroup

const ContextMenuSubTrigger = React.forwardRef<
  React.ElementRef<typeof ContextMenuPrimitive.SubTrigger>,
  React.ComponentPropsWithoutRef<typeof ContextMenuPrimitive.SubTrigger> & {
    inset?: boolean
  }
>(({ className, inset, children, ...props }, ref) => (
  <ContextMenuPrimitive.SubTrigger
    ref={ref}
    className={cn(
      "flex cursor-default select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none focus:bg-accent focus:text-accent-foreground data-[state=open]:bg-accent data-[state=open]:text-accent-foreground",
      inset && "pl-8",
      className,
    )}
    {...props}
  >
    {children}
    <ChevronRight className="ml-auto h-4 w-4" />
  </ContextMenuPrimitive.SubTrigger>
))
ContextMenuSubTrigger.displayName = ContextMenuPrimitive.SubTrigger.displayName

const ContextMenuSubContent = React.forwardRef<
  React.ElementRef<typeof ContextMenuPrimitive.SubContent>,
  React.ComponentPropsWithoutRef<typeof ContextMenuPrimitive.SubContent>
>(({ className, ...props }, ref) => (
  <ContextMenuPrimitive.SubContent
    ref={ref}
    className={cn(
      "z-50 min-w-[8rem] overflow-hidden rounded-md border bg-popover p-1 text-popover-foreground shadow-md data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2",
      className,
    )}
    {...props}
  />
))
ContextMenuSubContent.displayName = ContextMenuPrimitive.SubContent.displayName

const ContextMenuContent = React.forwardRef<
  React.ElementRef<typeof ContextMenuPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof ContextMenuPrimitive.Content>
>(({ className, ...props }, ref) => (
  <ContextMenuPrimitive.Portal>
    <ContextMenuPrimitive.Content
      ref={ref}
      className={cn(
        "z-50 min-w-[8rem] overflow-hidden rounded-md border bg-popover p-1 text-popover-foreground shadow-md animate-in fade-in-80 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2",
        className,
      )}
      {...props}
    />
  </ContextMenuPrimitive.Portal>
))
ContextMenuContent.displayName = ContextMenuPrimitive.Content.displayName

const ContextMenuItem = React.forwardRef<
  React.ElementRef<typeof ContextMenuPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof ContextMenuPrimitive.Item> & {
    inset?: boolean
  }
>(({ className, inset, ...props }, ref) => (
  <ContextMenuPrimitive.Item
    ref={ref}
    className={cn(
      "relative flex cursor-default select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
      inset && "pl-8",
      className,
    )}
    {...props}
  />
))
ContextMenuItem.displayName = ContextMenuPrimitive.Item.displayName

const ContextMenuCheckboxItem = React.forwardRef<
  React.ElementRef<typeof ContextMenuPrimitive.CheckboxItem>,
  React.ComponentPropsWithoutRef<typeof ContextMenuPrimitive.CheckboxItem>
>(({ className, children, checked, ...props }, ref) => (
  <ContextMenuPrimitive.CheckboxItem
    ref={ref}
    className={cn(
      "relative flex cursor-default select-none items-center rounded-sm py-1.5 pl-8 pr-2 text-sm outline-none focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
      className,
    )}
    checked={checked}
    {...props}
  >
    <span className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
      <ContextMenuPrimitive.ItemIndicator>
        <Check className="h-4 w-4" />
      </ContextMenuPrimitive.ItemIndicator>
    </span>
    {children}
  </ContextMenuPrimitive.CheckboxItem>
))
ContextMenuCheckboxItem.displayName =
  ContextMenuPrimitive.CheckboxItem.displayName

const ContextMenuRadioItem = React.forwardRef<
  React.ElementRef<typeof ContextMenuPrimitive.RadioItem>,
  React.ComponentPropsWithoutRef<typeof ContextMenuPrimitive.RadioItem>
>(({ className, children, ...props }, ref) => (
  <ContextMenuPrimitive.RadioItem
    ref={ref}
    className={cn(
      "relative flex cursor-default select-none items-center rounded-sm py-1.5 pl-8 pr-2 text-sm outline-none focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
      className,
    )}
    {...props}
  >
    <span className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
      <ContextMenuPrimitive.ItemIndicator>
        <Circle className="h-2 w-2 fill-current" />
      </ContextMenuPrimitive.ItemIndicator>
    </span>
    {children}
  </ContextMenuPrimitive.RadioItem>
))
ContextMenuRadioItem.displayName = ContextMenuPrimitive.RadioItem.displayName

const ContextMenuLabel = React.forwardRef<
  React.ElementRef<typeof ContextMenuPrimitive.Label>,
  React.ComponentPropsWithoutRef<typeof ContextMenuPrimitive.Label> & {
    inset?: boolean
  }
>(({ className, inset, ...props }, ref) => (
  <ContextMenuPrimitive.Label
    ref={ref}
    className={cn(
      "px-2 py-1.5 text-sm font-semibold text-foreground",
      inset && "pl-8",
      className,
    )}
    {...props}
  />
))
ContextMenuLabel.displayName = ContextMenuPrimitive.Label.displayName

const ContextMenuSeparator = React.forwardRef<
  React.ElementRef<typeof ContextMenuPrimitive.Separator>,
  React.ComponentPropsWithoutRef<typeof ContextMenuPrimitive.Separator>
>(({ className, ...props }, ref) => (
  <ContextMenuPrimitive.Separator
    ref={ref}
    className={cn("-mx-1 my-1 h-px bg-border", className)}
    {...props}
  />
))
ContextMenuSeparator.displayName = ContextMenuPrimitive.Separator.displayName

const ContextMenuShortcut = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLSpanElement>) => {
  return (
    <span
      className={cn(
        "ml-auto text-xs tracking-widest text-muted-foreground",
        className,
      )}
      {...props}
    />
  )
}
ContextMenuShortcut.displayName = "ContextMenuShortcut"

export {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuCheckboxItem,
  ContextMenuRadioItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuGroup,
  ContextMenuPortal,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuRadioGroup,
}

```
```tsx
shadcn/dropdown-menu
"use client"

import * as React from "react"
import * as DropdownMenuPrimitive from "@radix-ui/react-dropdown-menu"
import { Check, ChevronRight, Circle } from "lucide-react"

import { cn } from "@/lib/utils"

const DropdownMenu = DropdownMenuPrimitive.Root

const DropdownMenuTrigger = DropdownMenuPrimitive.Trigger

const DropdownMenuGroup = DropdownMenuPrimitive.Group

const DropdownMenuPortal = DropdownMenuPrimitive.Portal

const DropdownMenuSub = DropdownMenuPrimitive.Sub

const DropdownMenuRadioGroup = DropdownMenuPrimitive.RadioGroup

const DropdownMenuSubTrigger = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.SubTrigger>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.SubTrigger> & {
    inset?: boolean
  }
>(({ className, inset, children, ...props }, ref) => (
  <DropdownMenuPrimitive.SubTrigger
    ref={ref}
    className={cn(
      "flex cursor-default select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none focus:bg-accent data-[state=open]:bg-accent",
      inset && "pl-8",
      className,
    )}
    {...props}
  >
    {children}
    <ChevronRight className="ml-auto h-4 w-4" />
  </DropdownMenuPrimitive.SubTrigger>
))
DropdownMenuSubTrigger.displayName =
  DropdownMenuPrimitive.SubTrigger.displayName

const DropdownMenuSubContent = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.SubContent>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.SubContent>
>(({ className, ...props }, ref) => (
  <DropdownMenuPrimitive.SubContent
    ref={ref}
    className={cn(
      "z-50 min-w-[8rem] overflow-hidden rounded-md border bg-popover p-1 text-popover-foreground shadow-lg data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2",
      className,
    )}
    {...props}
  />
))
DropdownMenuSubContent.displayName =
  DropdownMenuPrimitive.SubContent.displayName

const DropdownMenuContent = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Content>
>(({ className, sideOffset = 4, ...props }, ref) => (
  <DropdownMenuPrimitive.Portal>
    <DropdownMenuPrimitive.Content
      ref={ref}
      sideOffset={sideOffset}
      className={cn(
        "z-50 min-w-[8rem] overflow-hidden rounded-md border bg-popover p-1 text-popover-foreground shadow-md data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2",
        className,
      )}
      {...props}
    />
  </DropdownMenuPrimitive.Portal>
))
DropdownMenuContent.displayName = DropdownMenuPrimitive.Content.displayName

const DropdownMenuItem = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Item> & {
    inset?: boolean
  }
>(({ className, inset, ...props }, ref) => (
  <DropdownMenuPrimitive.Item
    ref={ref}
    className={cn(
      "relative flex cursor-default select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none transition-colors focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
      inset && "pl-8",
      className,
    )}
    {...props}
  />
))
DropdownMenuItem.displayName = DropdownMenuPrimitive.Item.displayName

const DropdownMenuCheckboxItem = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.CheckboxItem>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.CheckboxItem>
>(({ className, children, checked, ...props }, ref) => (
  <DropdownMenuPrimitive.CheckboxItem
    ref={ref}
    className={cn(
      "relative flex cursor-default select-none items-center rounded-sm py-1.5 pl-8 pr-2 text-sm outline-none transition-colors focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
      className,
    )}
    checked={checked}
    {...props}
  >
    <span className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
      <DropdownMenuPrimitive.ItemIndicator>
        <Check className="h-4 w-4" />
      </DropdownMenuPrimitive.ItemIndicator>
    </span>
    {children}
  </DropdownMenuPrimitive.CheckboxItem>
))
DropdownMenuCheckboxItem.displayName =
  DropdownMenuPrimitive.CheckboxItem.displayName

const DropdownMenuRadioItem = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.RadioItem>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.RadioItem>
>(({ className, children, ...props }, ref) => (
  <DropdownMenuPrimitive.RadioItem
    ref={ref}
    className={cn(
      "relative flex cursor-default select-none items-center rounded-sm py-1.5 pl-8 pr-2 text-sm outline-none transition-colors focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
      className,
    )}
    {...props}
  >
    <span className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
      <DropdownMenuPrimitive.ItemIndicator>
        <Circle className="h-2 w-2 fill-current" />
      </DropdownMenuPrimitive.ItemIndicator>
    </span>
    {children}
  </DropdownMenuPrimitive.RadioItem>
))
DropdownMenuRadioItem.displayName = DropdownMenuPrimitive.RadioItem.displayName

const DropdownMenuLabel = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.Label>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Label> & {
    inset?: boolean
  }
>(({ className, inset, ...props }, ref) => (
  <DropdownMenuPrimitive.Label
    ref={ref}
    className={cn(
      "px-2 py-1.5 text-sm font-semibold",
      inset && "pl-8",
      className,
    )}
    {...props}
  />
))
DropdownMenuLabel.displayName = DropdownMenuPrimitive.Label.displayName

const DropdownMenuSeparator = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.Separator>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Separator>
>(({ className, ...props }, ref) => (
  <DropdownMenuPrimitive.Separator
    ref={ref}
    className={cn("-mx-1 my-1 h-px bg-muted", className)}
    {...props}
  />
))
DropdownMenuSeparator.displayName = DropdownMenuPrimitive.Separator.displayName

const DropdownMenuShortcut = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLSpanElement>) => {
  return (
    <span
      className={cn("ml-auto text-xs tracking-widest opacity-60", className)}
      {...props}
    />
  )
}
DropdownMenuShortcut.displayName = "DropdownMenuShortcut"

export {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuCheckboxItem,
  DropdownMenuRadioItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuGroup,
  DropdownMenuPortal,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuRadioGroup,
}

```
```tsx
shadcn/hover-card
"use client"

import * as React from "react"
import * as HoverCardPrimitive from "@radix-ui/react-hover-card"

import { cn } from "@/lib/utils"

const HoverCard = HoverCardPrimitive.Root

const HoverCardTrigger = HoverCardPrimitive.Trigger

const HoverCardContent = React.forwardRef<
  React.ElementRef<typeof HoverCardPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof HoverCardPrimitive.Content>
>(({ className, align = "center", sideOffset = 4, ...props }, ref) => (
  <HoverCardPrimitive.Content
    ref={ref}
    align={align}
    sideOffset={sideOffset}
    className={cn(
      "z-50 w-64 rounded-md border bg-popover p-4 text-popover-foreground shadow-md outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2",
      className,
    )}
    {...props}
  />
))
HoverCardContent.displayName = HoverCardPrimitive.Content.displayName

export { HoverCard, HoverCardTrigger, HoverCardContent }

```
```tsx
shadcn/avatar
"use client"

import * as React from "react"
import * as AvatarPrimitive from "@radix-ui/react-avatar"

import { cn } from "@/lib/utils"

const Avatar = React.forwardRef<
  React.ElementRef<typeof AvatarPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof AvatarPrimitive.Root>
>(({ className, ...props }, ref) => (
  <AvatarPrimitive.Root
    ref={ref}
    className={cn(
      "relative flex h-10 w-10 shrink-0 overflow-hidden rounded-full",
      className,
    )}
    {...props}
  />
))
Avatar.displayName = AvatarPrimitive.Root.displayName

const AvatarImage = React.forwardRef<
  React.ElementRef<typeof AvatarPrimitive.Image>,
  React.ComponentPropsWithoutRef<typeof AvatarPrimitive.Image>
>(({ className, ...props }, ref) => (
  <AvatarPrimitive.Image
    ref={ref}
    className={cn("aspect-square h-full w-full", className)}
    {...props}
  />
))
AvatarImage.displayName = AvatarPrimitive.Image.displayName

const AvatarFallback = React.forwardRef<
  React.ElementRef<typeof AvatarPrimitive.Fallback>,
  React.ComponentPropsWithoutRef<typeof AvatarPrimitive.Fallback>
>(({ className, ...props }, ref) => (
  <AvatarPrimitive.Fallback
    ref={ref}
    className={cn(
      "flex h-full w-full items-center justify-center rounded-full bg-muted",
      className,
    )}
    {...props}
  />
))
AvatarFallback.displayName = AvatarPrimitive.Fallback.displayName

export { Avatar, AvatarImage, AvatarFallback }

```

Install NPM dependencies:
```bash
lucide-react, framer-motion, @radix-ui/react-slot, class-variance-authority, @radix-ui/react-dialog, @radix-ui/react-label, @radix-ui/react-tooltip, @radix-ui/react-context-menu, @radix-ui/react-dropdown-menu, @radix-ui/react-hover-card, @radix-ui/react-avatar
```

Implementation Guidelines
1. Analyze the component structure and identify all required dependencies
2. Review the component's argumens and state
3. Identify any required context providers or hooks and install them
4. Questions to Ask
- What data/props will be passed to this component?
- Are there any specific state management requirements?
- Are there any required assets (images, icons, etc.)?
- What is the expected responsive behavior?
- What is the best place to use this component in the app?

Steps to integrate
0. Copy paste all the code above in the correct directories
1. Install external dependencies
2. Fill image assets with Unsplash stock images you know exist
3. Use lucide-react icons for svgs or logos if component requires them
