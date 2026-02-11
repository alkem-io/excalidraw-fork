import clsx from "clsx";
import React, { useState, useCallback, useRef, useEffect } from "react";

import {
  CLASSES,
  DEFAULT_SIDEBAR,
  TOOL_TYPE,
  arrayToMap,
  capitalizeString,
  isTestEnv,
  isShallowEqual,
  sceneCoordsToViewportCoords,
  viewportCoordsToSceneCoords,
} from "@excalidraw/common";

import { mutateElement } from "@excalidraw/element";

import { showSelectedShapeActions } from "@excalidraw/element";

import { ShapeCache } from "@excalidraw/element";

import type { NonDeletedExcalidrawElement } from "@excalidraw/element/types";

import { actionToggleElementLock, actionToggleStats } from "../actions";
import { trackEvent } from "../analytics";
import { isHandToolActive } from "../appState";
import { TunnelsContext, useInitializeTunnels } from "../context/tunnels";
import { UIAppStateContext } from "../context/ui-appState";
import { useAtom, useAtomValue } from "../editor-jotai";

import { t } from "../i18n";
import { calculateScrollCenter } from "../scene";

import { EmojiPickerPanel } from "./EmojiPickerPanel";
import { FloatingEmoji } from "./FloatingEmoji";

import { SelectedShapeActions, ShapesSwitcher } from "./Actions";
import { LoadingMessage } from "./LoadingMessage";
import { MobileMenu } from "./MobileMenu";
import { PasteChartDialog } from "./PasteChartDialog";
import { Section } from "./Section";
import Stack from "./Stack";
import { UserList } from "./UserList";
import { PenModeButton } from "./PenModeButton";
import Footer from "./footer/Footer";
import { isSidebarDockedAtom } from "./Sidebar/Sidebar";
import MainMenu from "./main-menu/MainMenu";
import { ActiveConfirmDialog } from "./ActiveConfirmDialog";
import { useDevice } from "./App";
import { OverwriteConfirmDialog } from "./OverwriteConfirm/OverwriteConfirm";
import { LibraryIcon } from "./icons";
import { DefaultSidebar } from "./DefaultSidebar";
import { TTDDialog } from "./TTDDialog/TTDDialog";
import { Stats } from "./Stats";
import ElementLinkDialog from "./ElementLinkDialog";
import { ErrorDialog } from "./ErrorDialog";
import { EyeDropper, activeEyeDropperAtom } from "./EyeDropper";
import { FixedSideContainer } from "./FixedSideContainer";
import { HandButton } from "./HandButton";
import { HelpDialog } from "./HelpDialog";
import { HintViewer } from "./HintViewer";
import { ImageExportDialog } from "./ImageExportDialog";
import { Island } from "./Island";
import { JSONExportDialog } from "./JSONExportDialog";
import { LaserPointerButton } from "./LaserPointerButton";
import { ReactionModeButton } from "./ReactionModeButton";

import "./LayerUI.scss";
import "./Toolbar.scss";

import { LockElementButton } from "./LockElementButton";

import type { ActionManager } from "../actions/manager";

import type { Language } from "../i18n";
import type {
  AppProps,
  AppState,
  ExcalidrawProps,
  BinaryFiles,
  UIAppState,
  AppClassProperties,
} from "../types";

interface LayerUIProps {
  actionManager: ActionManager;
  appState: UIAppState;
  files: BinaryFiles;
  canvas: HTMLCanvasElement;
  setAppState: React.Component<any, AppState>["setState"];
  elements: readonly NonDeletedExcalidrawElement[];
  onLockToggle: () => void;
  onHandToolToggle: () => void;
  onPenModeToggle: AppClassProperties["togglePenMode"];
  showExitZenModeBtn: boolean;
  langCode: Language["code"];
  renderTopRightUI?: ExcalidrawProps["renderTopRightUI"];
  renderCustomStats?: ExcalidrawProps["renderCustomStats"];
  UIOptions: AppProps["UIOptions"];
  onExportImage: AppClassProperties["onExportImage"];
  renderWelcomeScreen: boolean;
  children?: React.ReactNode;
  app: AppClassProperties;
  isCollaborating: boolean;
  generateLinkForSelection?: AppProps["generateLinkForSelection"];
}

const DefaultMainMenu: React.FC<{
  UIOptions: AppProps["UIOptions"];
}> = ({ UIOptions }) => {
  return (
    <MainMenu __fallback>
      <MainMenu.DefaultItems.LoadScene />
      <MainMenu.DefaultItems.SaveToActiveFile />
      {/* FIXME we should to test for this inside the item itself */}
      {UIOptions.canvasActions.export && <MainMenu.DefaultItems.Export />}
      {/* FIXME we should to test for this inside the item itself */}
      {UIOptions.canvasActions.saveAsImage && (
        <MainMenu.DefaultItems.SaveAsImage />
      )}
      <MainMenu.DefaultItems.SearchMenu />
      <MainMenu.DefaultItems.Help />
      <MainMenu.DefaultItems.ClearCanvas />
      <MainMenu.Separator />
      <MainMenu.Group title="Excalidraw links">
        <MainMenu.DefaultItems.Socials />
      </MainMenu.Group>
      <MainMenu.Separator />
      <MainMenu.DefaultItems.ToggleTheme />
      <MainMenu.DefaultItems.ChangeCanvasBackground />
    </MainMenu>
  );
};

const DefaultOverwriteConfirmDialog = () => {
  return (
    <OverwriteConfirmDialog __fallback>
      <OverwriteConfirmDialog.Actions.SaveToDisk />
      <OverwriteConfirmDialog.Actions.ExportToImage />
    </OverwriteConfirmDialog>
  );
};

const LayerUI = ({
  actionManager,
  appState,
  files,
  setAppState,
  elements,
  canvas,
  onLockToggle,
  onHandToolToggle,
  onPenModeToggle,
  showExitZenModeBtn,
  renderTopRightUI,
  renderCustomStats,
  UIOptions,
  onExportImage,
  renderWelcomeScreen,
  children,
  app,
  isCollaborating,
  generateLinkForSelection,
}: LayerUIProps) => {
  const device = useDevice();
  const tunnels = useInitializeTunnels();

  // Emoji / reactions state
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [floatingEmojis, setFloatingEmojis] = useState<
    Array<{ id: string; emoji: string; sceneX: number; sceneY: number }>
  >([]);
  const [reactionModeActive, setReactionModeActive] = useState(false);
  const [reactionEmoji, setReactionEmoji] = useState<string | null>(null);
  const lastSpawnRef = useRef<number>(0);
  const [showReactionCoach, setShowReactionCoach] = useState(false);
  const lastToggleTimeRef = useRef<number>(0);
  const [overlayDisabled, setOverlayDisabled] = useState(false);
  const overlayDisableTimeoutRef = useRef<number | null>(null);
  const [pickerPos, setPickerPos] = useState<{
    left: number;
    bottom: number;
  } | null>(null);
  const [overlayBottomCutout, setOverlayBottomCutout] = useState<number>(60);

  // Subscribe to incoming ephemeral UI events from collab
  useEffect(() => {
    const unsubEmoji = app.onIncomingFloatingEmojiEmitter?.on((payload) => {
      setFloatingEmojis((prev) => [
        ...prev,
        {
          id: payload.id,
          emoji: payload.emoji,
          sceneX: payload.x,
          sceneY: payload.y,
        },
      ]);
    });

    return () => {
      unsubEmoji && unsubEmoji();
    };
  }, [app]);

  // initialize persisted state and keyboard shortcut
  useEffect(() => {
    if (!isTestEnv()) {
      try {
        const persisted = localStorage.getItem("excalidraw.reactionModeActive");
        if (persisted === "true") {
          setReactionModeActive(true);
        }
        const coachSeen = localStorage.getItem(
          "excalidraw.reactionModeCoachSeen",
        );
        if (!coachSeen) {
          setShowReactionCoach(true);
        }
      } catch (e) {
        // ignore localStorage errors
      }
    }

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "r" || e.key === "R") {
        toggleReactionMode();
      }
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    return () => {
      if (overlayDisableTimeoutRef.current) {
        window.clearTimeout(overlayDisableTimeoutRef.current);
        overlayDisableTimeoutRef.current = null;
      }
    };
  }, []);

  // compute picker position anchored to the toolbar reaction button
  useEffect(() => {
    if (!showEmojiPicker) {
      setPickerPos(null);
      return;
    }

    const compute = () => {
      const btn = document.querySelector<HTMLElement>(
        ".reaction-toolbar-button",
      );
      if (btn) {
        const rect = btn.getBoundingClientRect();
        // place below the toolbar button, aligned to its right edge
        const left = rect.right;
        const bottom = window.innerHeight - rect.bottom - 8;
        setPickerPos({ left, bottom });
      } else {
        // fallback
        setPickerPos({ left: window.innerWidth - 24, bottom: 96 });
      }
    };

    compute();
    window.addEventListener("resize", compute);
    window.addEventListener("scroll", compute);
    return () => {
      window.removeEventListener("resize", compute);
      window.removeEventListener("scroll", compute);
    };
  }, [showEmojiPicker]);

  // The reaction overlay covers the canvas. Since the toolbar button is at the
  // top (above the overlay's z-index), we only need a small bottom cutout to
  // keep the footer clickable.
  useEffect(() => {
    setOverlayBottomCutout(60);
  }, [reactionModeActive]);

  const spawnEmoji = useCallback(
    (clientX: number, clientY: number) => {
      if (!reactionEmoji) {
        return;
      }
      const id = Math.random().toString(36).slice(2);
      const emoji = reactionEmoji;

      const canvasRect = canvas?.getBoundingClientRect();
      const offsetLeft = canvasRect?.left ?? 0;
      const offsetTop = canvasRect?.top ?? 0;

      const { x: sceneX, y: sceneY } = viewportCoordsToSceneCoords(
        { clientX, clientY },
        {
          zoom: appState.zoom,
          offsetLeft,
          offsetTop,
          scrollX: app.state.scrollX,
          scrollY: app.state.scrollY,
        },
      );

      // Show locally immediately
      setFloatingEmojis((prev) => [...prev, { id, emoji, sceneX, sceneY }]);
      try {
        app.props.onRequestBroadcastFloatingEmoji?.(emoji, sceneX, sceneY);
      } catch (e) {
        // ignore
      }
    },
    [reactionEmoji, app, appState.zoom, canvas],
  );

  // When reaction mode is active, we render an overlay on top of the canvas.
  // Since it intercepts pointer events, forward pointer updates to the host
  // `onPointerUpdate` callback so collab cursors (and usernames) keep tracking.
  const reactionPointersMapRef = useRef<Map<number, { x: number; y: number }>>(
    new Map(),
  );
  const reactionCursorButtonRef = useRef<"up" | "down">("up");
  const reactionRafRef = useRef<number | null>(null);
  const reactionPendingPointerRef = useRef<{
    clientX: number;
    clientY: number;
    pointerId: number;
  } | null>(null);

  const forwardPointerUpdate = useCallback(
    (clientX: number, clientY: number, pointerId: number) => {
      if (!app.props.onPointerUpdate) {
        return;
      }

      // Match the semantics of App's gesture pointersMap:
      // - for mouse hover (button up) we forward an empty pointersMap
      // - when pointer is down, keep a 1-pointer entry
      const pointersMap = reactionPointersMapRef.current;
      const isDown = reactionCursorButtonRef.current === "down";
      if (isDown) {
        const existing = pointersMap.get(pointerId);
        if (existing) {
          existing.x = clientX;
          existing.y = clientY;
        } else {
          pointersMap.set(pointerId, { x: clientX, y: clientY });
        }
      } else {
        pointersMap.delete(pointerId);
      }

      const canvasRect = canvas?.getBoundingClientRect();
      const offsetLeft = canvasRect?.left ?? 0;
      const offsetTop = canvasRect?.top ?? 0;

      const { x: sceneX, y: sceneY } = viewportCoordsToSceneCoords(
        { clientX, clientY },
        {
          zoom: appState.zoom,
          offsetLeft,
          offsetTop,
          scrollX: app.state.scrollX,
          scrollY: app.state.scrollY,
        },
      );

      app.props.onPointerUpdate({
        pointer: {
          x: sceneX,
          y: sceneY,
          tool: app.state.activeTool.type === "laser" ? "laser" : "pointer",
        },
        button: reactionCursorButtonRef.current,
        pointersMap,
      });
    },
    [app, appState.zoom, canvas],
  );

  const scheduleForwardPointerUpdate = useCallback(
    (clientX: number, clientY: number, pointerId: number) => {
      reactionPendingPointerRef.current = { clientX, clientY, pointerId };
      if (reactionRafRef.current != null) {
        return;
      }
      reactionRafRef.current = window.requestAnimationFrame(() => {
        reactionRafRef.current = null;
        const pending = reactionPendingPointerRef.current;
        if (!pending) {
          return;
        }
        forwardPointerUpdate(
          pending.clientX,
          pending.clientY,
          pending.pointerId,
        );
      });
    },
    [forwardPointerUpdate],
  );

  useEffect(() => {
    return () => {
      if (reactionRafRef.current != null) {
        window.cancelAnimationFrame(reactionRafRef.current);
        reactionRafRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!reactionModeActive) {
      reactionCursorButtonRef.current = "up";
      reactionPointersMapRef.current.clear();
      reactionPendingPointerRef.current = null;
      if (reactionRafRef.current != null) {
        window.cancelAnimationFrame(reactionRafRef.current);
        reactionRafRef.current = null;
      }
    }
  }, [reactionModeActive]);

  const toggleReactionMode = useCallback(() => {
    try {
      lastToggleTimeRef.current = performance.now();
    } catch (err) {}
    // temporarily disable overlay to avoid immediate accidental spawns
    setOverlayDisabled(true);
    if (overlayDisableTimeoutRef.current) {
      window.clearTimeout(overlayDisableTimeoutRef.current);
    }
    overlayDisableTimeoutRef.current = window.setTimeout(() => {
      setOverlayDisabled(false);
      overlayDisableTimeoutRef.current = null;
    }, 350) as unknown as number;

    setReactionModeActive((active) => {
      // turn off
      if (active) {
        setReactionEmoji(null);
        setShowEmojiPicker(false);
        if (!isTestEnv()) {
          try {
            localStorage.setItem("excalidraw.reactionModeActive", "false");
          } catch (err) { }
        }
        return false;
      }

      // turn on but no emoji selected -> open picker first
      if (!reactionEmoji) {
        setShowEmojiPicker(true);
        if (!isTestEnv()) {
          try {
            localStorage.setItem("excalidraw.reactionModeActive", "false");
          } catch (err) { }
        }
        return false;
      }

      // turn on with emoji selected
      if (!isTestEnv()) {
        try {
          localStorage.setItem("excalidraw.reactionModeActive", "true");
          if (showReactionCoach) {
            localStorage.setItem("excalidraw.reactionModeCoachSeen", "true");
            setShowReactionCoach(false);
          }
        } catch (err) { }
      }
      try {
        lastToggleTimeRef.current = performance.now();
      } catch (err) { }
      return true;
    });
  }, [reactionEmoji, showReactionCoach]);

  const TunnelsJotaiProvider = tunnels.tunnelsJotai.Provider;

  const [eyeDropperState, setEyeDropperState] = useAtom(activeEyeDropperAtom);

  const renderJSONExportDialog = () => {
    if (!UIOptions.canvasActions.export) {
      return null;
    }

    return (
      <JSONExportDialog
        elements={elements}
        appState={appState}
        files={files}
        actionManager={actionManager}
        exportOpts={UIOptions.canvasActions.export}
        canvas={canvas}
        setAppState={setAppState}
      />
    );
  };

  const renderImageExportDialog = () => {
    if (
      !UIOptions.canvasActions.saveAsImage ||
      appState.openDialog?.name !== "imageExport"
    ) {
      return null;
    }

    return (
      <ImageExportDialog
        elements={elements}
        appState={appState}
        files={files}
        actionManager={actionManager}
        onExportImage={onExportImage}
        onCloseRequest={() => setAppState({ openDialog: null })}
        name={app.getName()}
      />
    );
  };

  const renderCanvasActions = () => (
    <div style={{ position: "relative" }}>
      {/* wrapping to Fragment stops React from occasionally complaining
                about identical Keys */}
      <tunnels.MainMenuTunnel.Out />
      {renderWelcomeScreen && <tunnels.WelcomeScreenMenuHintTunnel.Out />}
    </div>
  );

  const renderSelectedShapeActions = () => (
    <Section
      heading="selectedShapeActions"
      className={clsx("selected-shape-actions zen-mode-transition", {
        "transition-left": appState.zenModeEnabled,
      })}
    >
      <Island
        className={CLASSES.SHAPE_ACTIONS_MENU}
        padding={2}
        style={{
          // we want to make sure this doesn't overflow so subtracting the
          // approximate height of hamburgerMenu + footer
          maxHeight: `${appState.height - 166}px`,
        }}
      >
        <SelectedShapeActions
          appState={appState}
          elementsMap={app.scene.getNonDeletedElementsMap()}
          renderAction={actionManager.renderAction}
          app={app}
        />
      </Island>
    </Section>
  );

  const allElementsLocked = (elementsIds: string[]) => {
    if (elementsIds.length === 0) {
      return false;
    }
    return elements
      .filter((element) => elementsIds.includes(element.id))
      .every((element) => element.locked);
  };

  const renderFixedSideContainer = () => {
    const shouldRenderSelectedShapeActions = showSelectedShapeActions(
      appState,
      elements,
    );

    const shouldShowStats =
      appState.stats.open &&
      !appState.zenModeEnabled &&
      !appState.viewModeEnabled &&
      appState.openDialog?.name !== "elementLinkSelector";

    return (
      <FixedSideContainer side="top">
        <div className="App-menu App-menu_top">
          <Stack.Col gap={6} className={clsx("App-menu_top__left")}>
            {renderCanvasActions()}
            {shouldRenderSelectedShapeActions && renderSelectedShapeActions()}
          </Stack.Col>
          {!appState.viewModeEnabled &&
            appState.openDialog?.name !== "elementLinkSelector" && (
              <Section heading="shapes" className="shapes-section">
                {(heading: React.ReactNode) => (
                  <div style={{ position: "relative" }}>
                    {renderWelcomeScreen && (
                      <tunnels.WelcomeScreenToolbarHintTunnel.Out />
                    )}
                    <Stack.Col gap={4} align="start">
                      <Stack.Row
                        gap={1}
                        className={clsx("App-toolbar-container", {
                          "zen-mode": appState.zenModeEnabled,
                        })}
                      >
                        <Island
                          padding={1}
                          className={clsx("App-toolbar", {
                            "zen-mode": appState.zenModeEnabled,
                          })}
                        >
                          <HintViewer
                            appState={appState}
                            isMobile={device.editor.isMobile}
                            device={device}
                            app={app}
                          />
                          {heading}
                          <Stack.Row gap={1}>
                            <PenModeButton
                              zenModeEnabled={appState.zenModeEnabled}
                              checked={appState.penMode}
                              onChange={() => onPenModeToggle(null)}
                              title={t("toolBar.penMode")}
                              penDetected={appState.penDetected}
                            />
                            <LockElementButton
                              disabled={
                                Object.keys(appState.selectedElementIds)
                                  .length === 0
                              }
                              checked={allElementsLocked(
                                Object.keys(appState.selectedElementIds),
                              )}
                              onChange={() =>
                                actionManager.executeAction(
                                  actionToggleElementLock,
                                )
                              }
                              title={t("toolBar.lockElements")}
                            />

                            <div className="App-toolbar__divider" />

                            <HandButton
                              checked={isHandToolActive(appState)}
                              onChange={() => onHandToolToggle()}
                              title={t("toolBar.hand")}
                              isMobile
                            />

                            <ShapesSwitcher
                              appState={appState}
                              activeTool={appState.activeTool}
                              UIOptions={UIOptions}
                              app={app}
                              onToggleReactionMode={toggleReactionMode}
                              reactionModeActive={reactionModeActive}
                            />
                          </Stack.Row>
                        </Island>
                        {isCollaborating && (
                          <Island
                            style={{
                              marginLeft: 8,
                              alignSelf: "center",
                              height: "fit-content",
                            }}
                          >
                            <LaserPointerButton
                              title={t("toolBar.laser")}
                              checked={
                                appState.activeTool.type === TOOL_TYPE.laser
                              }
                              onChange={() =>
                                app.setActiveTool({ type: TOOL_TYPE.laser })
                              }
                              isMobile
                            />
                          </Island>
                        )}
                        <Island
                          className="reaction-toolbar-button"
                          style={{
                            marginLeft: 8,
                            alignSelf: "center",
                            height: "fit-content",
                          }}
                        >
                          <ReactionModeButton
                            active={reactionModeActive}
                            onClick={toggleReactionMode}
                            size="small"
                            label="Emoji reactions (R)"
                          />
                        </Island>
                      </Stack.Row>
                    </Stack.Col>
                  </div>
                )}
              </Section>
            )}
          <div
            className={clsx(
              "layer-ui__wrapper__top-right zen-mode-transition",
              {
                "transition-right": appState.zenModeEnabled,
              },
            )}
          >
            {appState.collaborators.size > 0 && (
              <UserList
                collaborators={appState.collaborators}
                userToFollow={appState.userToFollow?.socketId || null}
              />
            )}
            {renderTopRightUI?.(device.editor.isMobile, appState)}
            {!appState.viewModeEnabled &&
              appState.openDialog?.name !== "elementLinkSelector" &&
              // hide button when sidebar docked
              (!isSidebarDocked ||
                appState.openSidebar?.name !== DEFAULT_SIDEBAR.name) && (
                <tunnels.DefaultSidebarTriggerTunnel.Out />
              )}
            {shouldShowStats && (
              <Stats
                app={app}
                onClose={() => {
                  actionManager.executeAction(actionToggleStats);
                }}
                renderCustomStats={renderCustomStats}
              />
            )}
          </div>
        </div>
      </FixedSideContainer>
    );
  };

  const renderSidebars = () => {
    return (
      <DefaultSidebar
        __fallback
        onDock={(docked) => {
          trackEvent(
            "sidebar",
            `toggleDock (${docked ? "dock" : "undock"})`,
            `(${device.editor.isMobile ? "mobile" : "desktop"})`,
          );
        }}
      />
    );
  };

  const isSidebarDocked = useAtomValue(isSidebarDockedAtom);

  const layerUIJSX = (
    <>
      {/* ------------------------- tunneled UI ---------------------------- */}
      {/* make sure we render host app components first so that we can detect
          them first on initial render to optimize layout shift */}
      {children}
      {/* render component fallbacks. Can be rendered anywhere as they'll be
          tunneled away. We only render tunneled components that actually
        have defaults when host do not render anything. */}
      <DefaultMainMenu UIOptions={UIOptions} />
      <DefaultSidebar.Trigger
        __fallback
        icon={LibraryIcon}
        title={capitalizeString(t("toolBar.library"))}
        onToggle={(open) => {
          if (open) {
            trackEvent(
              "sidebar",
              `${DEFAULT_SIDEBAR.name} (open)`,
              `button (${device.editor.isMobile ? "mobile" : "desktop"})`,
            );
          }
        }}
        tab={DEFAULT_SIDEBAR.defaultTab}
      >
        {t("toolBar.library")}
      </DefaultSidebar.Trigger>
      <DefaultOverwriteConfirmDialog />
      {appState.openDialog?.name === "ttd" && <TTDDialog __fallback />}
      {/* ------------------------------------------------------------------ */}

      {appState.isLoading && <LoadingMessage delay={250} />}
      {appState.errorMessage && (
        <ErrorDialog onClose={() => setAppState({ errorMessage: null })}>
          {appState.errorMessage}
        </ErrorDialog>
      )}
      {eyeDropperState && !device.editor.isMobile && (
        <EyeDropper
          colorPickerType={eyeDropperState.colorPickerType}
          onCancel={() => {
            setEyeDropperState(null);
          }}
          onChange={(colorPickerType, color, selectedElements, { altKey }) => {
            if (
              colorPickerType !== "elementBackground" &&
              colorPickerType !== "elementStroke"
            ) {
              return;
            }

            if (selectedElements.length) {
              for (const element of selectedElements) {
                mutateElement(element, arrayToMap(elements), {
                  [altKey && eyeDropperState.swapPreviewOnAlt
                    ? colorPickerType === "elementBackground"
                      ? "strokeColor"
                      : "backgroundColor"
                    : colorPickerType === "elementBackground"
                    ? "backgroundColor"
                    : "strokeColor"]: color,
                });
                ShapeCache.delete(element);
              }
              app.scene.triggerUpdate();
            } else if (colorPickerType === "elementBackground") {
              setAppState({
                currentItemBackgroundColor: color,
              });
            } else {
              setAppState({ currentItemStrokeColor: color });
            }
          }}
          onSelect={(color, event) => {
            setEyeDropperState((state) => {
              return state?.keepOpenOnAlt && event.altKey ? state : null;
            });
            eyeDropperState?.onSelect?.(color, event);
          }}
        />
      )}
      {appState.openDialog?.name === "help" && (
        <HelpDialog
          onClose={() => {
            setAppState({ openDialog: null });
          }}
        />
      )}
      <ActiveConfirmDialog />
      {appState.openDialog?.name === "elementLinkSelector" && (
        <ElementLinkDialog
          sourceElementId={appState.openDialog.sourceElementId}
          onClose={() => {
            setAppState({
              openDialog: null,
            });
          }}
          scene={app.scene}
          appState={appState}
          generateLinkForSelection={generateLinkForSelection}
        />
      )}
      <tunnels.OverwriteConfirmDialogTunnel.Out />
      {renderImageExportDialog()}
      {renderJSONExportDialog()}
      {appState.pasteDialog.shown && (
        <PasteChartDialog
          setAppState={setAppState}
          appState={appState}
          onClose={() =>
            setAppState({
              pasteDialog: { shown: false, data: null },
            })
          }
        />
      )}
      {device.editor.isMobile && (
        <MobileMenu
          app={app}
          appState={appState}
          elements={elements}
          actionManager={actionManager}
          renderJSONExportDialog={renderJSONExportDialog}
          renderImageExportDialog={renderImageExportDialog}
          setAppState={setAppState}
          onLockToggle={onLockToggle}
          onHandToolToggle={onHandToolToggle}
          onPenModeToggle={onPenModeToggle}
          renderTopRightUI={renderTopRightUI}
          renderCustomStats={renderCustomStats}
          renderSidebars={renderSidebars}
          device={device}
          renderWelcomeScreen={renderWelcomeScreen}
          UIOptions={UIOptions}
        />
      )}
      {!device.editor.isMobile && (
        <>
          <div
            className="layer-ui__wrapper"
            style={
              appState.openSidebar &&
              isSidebarDocked &&
              device.editor.canFitSidebar
                ? { width: `calc(100% - var(--right-sidebar-width))` }
                : {}
            }
          >
            {renderWelcomeScreen && <tunnels.WelcomeScreenCenterTunnel.Out />}
            {renderFixedSideContainer()}

            {/* Reaction overlay & UI */}
            {reactionModeActive && reactionEmoji && (
              <div
                style={{
                  position: "fixed",
                  left: 0,
                  top: 0,
                  right: 0,
                  bottom: overlayBottomCutout, // keep footer clickable
                  cursor: "pointer",
                  zIndex: 900, // below floating emojis so they remain visible
                  // Parent layer-ui wrapper disables pointer events, so opt-in here
                  pointerEvents: overlayDisabled ? "none" : "auto",
                }}
                onPointerMove={(e) => {
                  scheduleForwardPointerUpdate(
                    e.clientX,
                    e.clientY,
                    e.pointerId,
                  );
                }}
                onPointerDown={(e) => {
                  // ignore immediate pointerdown that comes from toggling via toolbar button
                  try {
                    const now = performance.now();
                    if (now - (lastToggleTimeRef.current || 0) < 300) {
                      // swallow event
                      return;
                    }
                  } catch (err) {}

                  reactionCursorButtonRef.current = "down";
                  scheduleForwardPointerUpdate(
                    e.clientX,
                    e.clientY,
                    e.pointerId,
                  );

                  e.stopPropagation();
                  spawnEmoji(e.clientX, e.clientY);
                  lastSpawnRef.current = performance.now();
                  const move = (ev: PointerEvent) => {
                    const now = performance.now();
                    if (now - lastSpawnRef.current > 90) {
                      spawnEmoji(ev.clientX, ev.clientY);
                      lastSpawnRef.current = now;
                    }

                    scheduleForwardPointerUpdate(
                      ev.clientX,
                      ev.clientY,
                      ev.pointerId,
                    );
                  };
                  const up = (ev: PointerEvent) => {
                    reactionCursorButtonRef.current = "up";
                    scheduleForwardPointerUpdate(
                      ev.clientX,
                      ev.clientY,
                      ev.pointerId,
                    );
                    window.removeEventListener("pointermove", move);
                    window.removeEventListener("pointerup", up);
                  };
                  window.addEventListener("pointermove", move);
                  window.addEventListener("pointerup", up);
                }}
              />
            )}

            <Footer
              appState={appState}
              actionManager={actionManager}
              showExitZenModeBtn={showExitZenModeBtn}
              renderWelcomeScreen={renderWelcomeScreen}
            />

            {showEmojiPicker && !reactionModeActive && (
              <div
                className="emoji-picker-wrapper--fab"
                data-testid="emoji-picker-wrapper"
                style={
                  pickerPos
                    ? {
                        position: "fixed",
                        left: pickerPos.left,
                        bottom: pickerPos.bottom,
                        transform: "translateX(-100%)",
                        zIndex: 3000,
                        pointerEvents: "auto",
                      }
                    : undefined
                }
              >
                <EmojiPickerPanel
                  onSelect={(emoji) => {
                    setReactionEmoji(emoji);
                    setShowEmojiPicker(false);
                    setReactionModeActive(true);
                  }}
                  onClose={() => setShowEmojiPicker(false)}
                />
              </div>
            )}

            {appState.scrolledOutside && (
              <button
                type="button"
                className="scroll-back-to-content"
                onClick={() => {
                  setAppState((appState) => ({
                    ...calculateScrollCenter(elements, appState),
                  }));
                }}
              >
                {t("buttons.scrollBackToContent")}
              </button>
            )}
          </div>
          {renderSidebars()}
        </>
      )}
    </>
  );

  const canvasRect = canvas?.getBoundingClientRect();
  const canvasOffsetLeft = canvasRect?.left ?? 0;
  const canvasOffsetTop = canvasRect?.top ?? 0;

  return (
    <UIAppStateContext.Provider value={appState}>
      <TunnelsJotaiProvider>
        <TunnelsContext.Provider value={tunnels}>
          {layerUIJSX}

          {/* Floating emojis */}
          {floatingEmojis.map((e) => {
            const { x, y } = sceneCoordsToViewportCoords(
              { sceneX: e.sceneX, sceneY: e.sceneY },
              {
                zoom: appState.zoom,
                offsetLeft: canvasOffsetLeft,
                offsetTop: canvasOffsetTop,
                scrollX: app.state.scrollX,
                scrollY: app.state.scrollY,
              },
            );

            return (
              <FloatingEmoji
                key={e.id}
                emoji={e.emoji}
                x={x}
                y={y}
                onDone={() =>
                  setFloatingEmojis((prev) => prev.filter((p) => p.id !== e.id))
                }
              />
            );
          })}
        </TunnelsContext.Provider>
      </TunnelsJotaiProvider>
    </UIAppStateContext.Provider>
  );
};

const stripIrrelevantAppStateProps = (appState: AppState): UIAppState => {
  const {
    suggestedBindings,
    startBoundElement,
    cursorButton,
    scrollX,
    scrollY,
    ...ret
  } = appState;
  return ret;
};

const areEqual = (prevProps: LayerUIProps, nextProps: LayerUIProps) => {
  // short-circuit early
  if (prevProps.children !== nextProps.children) {
    return false;
  }

  const { canvas: _pC, appState: prevAppState, ...prev } = prevProps;
  const { canvas: _nC, appState: nextAppState, ...next } = nextProps;

  return (
    isShallowEqual(
      // asserting AppState because we're being passed the whole AppState
      // but resolve to only the UI-relevant props
      stripIrrelevantAppStateProps(prevAppState as AppState),
      stripIrrelevantAppStateProps(nextAppState as AppState),
      {
        selectedElementIds: isShallowEqual,
        selectedGroupIds: isShallowEqual,
      },
    ) && isShallowEqual(prev, next)
  );
};

export default React.memo(LayerUI, areEqual);
