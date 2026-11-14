"use client";

import { createContext, useCallback, useContext, useEffect, useRef, type ReactNode } from "react";
import { readPlace, usePlaceMemory } from "@/components/home/return-place";
import { POPULAR_SECTION_IDS, type PopularSectionId } from "./popular-sections";

type PlaceApi = {
  /** A section's tiles are on the page: restores the place if the saved tile is among them. Then the section is settled. */
  tilesShown: (section: PopularSectionId, tileKeys: ReadonlySet<string>) => void;
  /** A section has nothing to restore into (an error, or no titles). */
  settled: (section: PopularSectionId) => void;
};

const PlaceContext = createContext<PlaceApi | null>(null);

/**
 * Wraps the Popular page so going to a title and coming back returns to the same place, as on Home. One place memory
 * serves every section. A click on a tile's link saves that tile and where it sat (the tiles carry data-focus-key).
 * Coming back, the section that holds the saved tile restores as soon as it has rendered. If no section holds it (the
 * list changed), the saved scroll position is restored once every section has rendered. The service and Movies/TV
 * choice live in the address, so going back restores them with the page. No filter is saved.
 */
export function PopularPlace({ children }: { children: ReactNode }) {
  const { onGridClick, restore } = usePlaceMemory("/popular", null);
  const settledIds = useRef(new Set<PopularSectionId>());

  // A page that is left is kept hidden, and its effects run again when it is shown. Start each visit with none settled.
  useEffect(
    () => () => {
      settledIds.current.clear();
    },
    [],
  );

  const settled = useCallback(
    (section: PopularSectionId) => {
      settledIds.current.add(section);
      // Every section has rendered and none had the saved tile: restore by scroll position. No-op if already restored.
      if (settledIds.current.size === POPULAR_SECTION_IDS.length) restore();
    },
    [restore],
  );

  const tilesShown = useCallback(
    (section: PopularSectionId, tileKeys: ReadonlySet<string>) => {
      const saved = readPlace("/popular")?.tileKey;
      if (saved && tileKeys.has(saved)) restore();
      settled(section);
    },
    [restore, settled],
  );

  return (
    <PlaceContext.Provider value={{ tilesShown, settled }}>
      <div className="space-y-8" onClickCapture={onGridClick}>
        {children}
      </div>
    </PlaceContext.Provider>
  );
}

/** Renders nothing. Tells the page a section ended without tiles (an error, an empty list), so a scroll restore isn't left waiting. */
export function SectionSettled({ section }: { section: PopularSectionId }) {
  const place = useContext(PlaceContext);
  useEffect(() => {
    place?.settled(section);
  }, [place, section]);
  return null;
}

/** For PopularTiles. */
export function usePopularPlace(): PlaceApi | null {
  return useContext(PlaceContext);
}
