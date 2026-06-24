import { useEffect, useRef, useState } from "react";

import { useNavigate } from "react-router-dom";

import { useQuery } from "@tanstack/react-query";

import {

  FileSearch,

  FileText,

  Loader2,

  Receipt,

  Search,

  ShoppingCart,

  Users,

} from "lucide-react";

import type { LucideIcon } from "lucide-react";



import { apiGet } from "../api/erpnext";

import { FEATURE_FLAGS } from "../config/featureFlags";

import { useDebounce } from "../hooks/useDebounce";



interface BaseHit {

  name: string;

  description?: string;

}



interface SupplierHit extends BaseHit {

  supplier_name: string;

  supplier_group?: string;

}



interface DocHit extends BaseHit {

  supplier?: string;

  status?: string;

}



interface SearchResults {

  suppliers: SupplierHit[];

  purchaseOrders: DocHit[];

  invoices: DocHit[];

  requisitions: DocHit[];

}



const PER_GROUP_LIMIT = 5;



interface ResultGroup {

  key: keyof SearchResults;

  label: string;

  icon: LucideIcon;

  hits: Array<{

    name: string;

    primary: string;

    secondary?: string;

    to: string;

  }>;

}



interface Props {
  /** Called after navigating to a search result (e.g. close mobile search panel). */
  onSelect?: () => void;
}

export default function GlobalSearch({ onSelect }: Props) {

  const navigate = useNavigate();

  const wrapperRef = useRef<HTMLDivElement>(null);

  const inputRef = useRef<HTMLInputElement>(null);

  const [query, setQuery] = useState("");

  const [open, setOpen] = useState(false);

  const debounced = useDebounce(query, 300);

  const trimmed = debounced.trim();



  useEffect(() => {

    function onDoc(e: MouseEvent) {

      if (

        wrapperRef.current &&

        !wrapperRef.current.contains(e.target as Node)

      ) {

        setOpen(false);

      }

    }

    document.addEventListener("mousedown", onDoc);

    return () => document.removeEventListener("mousedown", onDoc);

  }, []);



  useEffect(() => {

    function onKey(e: KeyboardEvent) {

      const isCmdK = (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k";

      if (isCmdK) {

        e.preventDefault();

        inputRef.current?.focus();

        setOpen(true);

      }

      if (e.key === "Escape") setOpen(false);

    }

    window.addEventListener("keydown", onKey);

    return () => window.removeEventListener("keydown", onKey);

  }, []);



  const { data, isFetching } = useQuery<SearchResults>({

    queryKey: ["global-search", trimmed],

    enabled: trimmed.length >= 2,

    staleTime: 30_000,

    queryFn: async () => {

      const like = `%${trimmed}%`;

      const [suppliers, purchaseOrders, invoices, requisitions] =

        await Promise.all([

          apiGet<SupplierHit[]>("/api/resource/Supplier", {

            params: {

              filters: JSON.stringify([

                ["supplier_name", "like", like],

              ]),

              fields: JSON.stringify([

                "name",

                "supplier_name",

                "supplier_group",

              ]),

              limit_page_length: PER_GROUP_LIMIT,

              order_by: "modified desc",

            },

          }).catch(() => [] as SupplierHit[]),

          apiGet<DocHit[]>("/api/resource/Purchase Order", {

            params: {

              filters: JSON.stringify([["name", "like", like]]),

              fields: JSON.stringify(["name", "supplier", "status"]),

              limit_page_length: PER_GROUP_LIMIT,

              order_by: "modified desc",

            },

          }).catch(() => [] as DocHit[]),

          apiGet<DocHit[]>("/api/resource/Purchase Invoice", {

            params: {

              filters: JSON.stringify([["name", "like", like]]),

              fields: JSON.stringify(["name", "supplier", "status"]),

              limit_page_length: PER_GROUP_LIMIT,

              order_by: "modified desc",

            },

          }).catch(() => [] as DocHit[]),

          FEATURE_FLAGS.showMaterialRequests

            ? apiGet<DocHit[]>("/api/resource/Material Request", {

                params: {

                  filters: JSON.stringify([

                    ["material_request_type", "=", "Purchase"],

                    ["name", "like", like],

                  ]),

                  fields: JSON.stringify(["name", "status"]),

                  limit_page_length: PER_GROUP_LIMIT,

                  order_by: "modified desc",

                },

              }).catch(() => [] as DocHit[])

            : Promise.resolve([] as DocHit[]),

        ]);



      return { suppliers, purchaseOrders, invoices, requisitions };

    },

  });



  const groups: ResultGroup[] = [

    {

      key: "suppliers",

      label: "Suppliers",

      icon: Users,

      hits: (data?.suppliers ?? []).map((s) => ({

        name: s.name,

        primary: s.supplier_name,

        secondary: s.supplier_group,

        to: `/suppliers/${encodeURIComponent(s.name)}`,

      })),

    },

    {

      key: "purchaseOrders",

      label: "Purchase Orders",

      icon: ShoppingCart,

      hits: (data?.purchaseOrders ?? []).map((p) => ({

        name: p.name,

        primary: p.name,

        secondary: [p.supplier, p.status].filter(Boolean).join(" • "),

        to: `/p2p/purchase-orders/${encodeURIComponent(p.name)}`,

      })),

    },

    {

      key: "invoices",

      label: "Invoices",

      icon: Receipt,

      hits: (data?.invoices ?? []).map((p) => ({

        name: p.name,

        primary: p.name,

        secondary: [p.supplier, p.status].filter(Boolean).join(" • "),

        to: `/p2p/invoices?q=${encodeURIComponent(p.name)}`,

      })),

    },

    ...(FEATURE_FLAGS.showMaterialRequests

      ? [

          {

            key: "requisitions" as keyof SearchResults,

            label: "Material Requests",

            icon: FileText,

            hits: (data?.requisitions ?? []).map((p) => ({

              name: p.name,

              primary: p.name,

              secondary: p.status,

              to: `/p2p/requisitions/${encodeURIComponent(p.name)}`,

            })),

          },

        ]

      : []),

  ];



  const totalHits = groups.reduce((s, g) => s + g.hits.length, 0);

  const showDropdown = open && trimmed.length >= 2;



  function handleNavigate(to: string) {
    setOpen(false);
    setQuery("");
    navigate(to);
    onSelect?.();
  }



  return (

    <div ref={wrapperRef} className="relative w-full max-w-md">

      <div className="relative">

        <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-neutral-400">

          {isFetching ? (

            <Loader2 className="h-4 w-4 animate-spin" />

          ) : (

            <Search className="h-4 w-4" />

          )}

        </span>

        <input

          ref={inputRef}

          value={query}

          onChange={(e) => {

            setQuery(e.target.value);

            setOpen(true);

          }}

          onFocus={() => trimmed.length >= 2 && setOpen(true)}

          placeholder={`Search suppliers, POs, invoices${FEATURE_FLAGS.showMaterialRequests ? ", PRs" : ""}…`}

          className="input-search pr-14"

        />

        <kbd className="pointer-events-none absolute inset-y-0 right-3 hidden items-center text-[10px] font-medium text-neutral-400 sm:flex">

          <span className="rounded border border-neutral-200 bg-white px-1.5 py-0.5">

            ⌘K

          </span>

        </kbd>

      </div>



      {showDropdown && (

        <div

          role="listbox"

          className="absolute left-0 right-0 top-full z-40 mt-2 max-h-[60vh] overflow-y-auto rounded-card border border-neutral-200 bg-white p-1 shadow-card-hover"

        >

          {totalHits === 0 && !isFetching && (

            <div className="flex flex-col items-center gap-1 px-3 py-6 text-center text-sm text-neutral-500">

              <FileSearch className="h-5 w-5 text-neutral-400" />

              <span>No results for "{trimmed}"</span>

            </div>

          )}



          {groups.map((group) =>

            group.hits.length === 0 ? null : (

              <div key={group.key} className="mb-1 last:mb-0">

                <div className="flex items-center gap-1.5 px-3 pt-2 pb-1 text-[11px] font-semibold uppercase tracking-[0.05em] text-neutral-400">

                  <group.icon className="h-3 w-3" />

                  {group.label}

                </div>

                <ul>

                  {group.hits.map((hit) => (

                    <li key={`${group.key}-${hit.name}`}>

                      <button

                        type="button"

                        onClick={() => handleNavigate(hit.to)}

                        className="flex w-full items-start justify-between gap-2 rounded-lg px-3 py-2 text-left text-sm hover:bg-neutral-50"

                      >

                        <div className="min-w-0 flex-1">

                          <p className="truncate font-medium text-neutral-900">

                            {hit.primary}

                          </p>

                          {hit.secondary && (

                            <p className="truncate text-xs text-neutral-500">

                              {hit.secondary}

                            </p>

                          )}

                        </div>

                        <span className="text-[10px] uppercase tracking-wide text-neutral-400">

                          {hit.name}

                        </span>

                      </button>

                    </li>

                  ))}

                </ul>

              </div>

            )

          )}

        </div>

      )}

    </div>

  );

}


