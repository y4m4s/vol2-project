import React, { useState } from "react";
import { BackHeader } from "../webview/components/BackHeader";
import { Badge } from "../webview/components/Badge";
import { useApp } from "../webview/state/AppContext";

export function S05Knowledge() {
  const { viewModel, send } = useApp();
  const [filter, setFilter] = useState<"すべて" | "有効" | "無効">("すべて");
  const [searchQuery, setSearchQuery] = useState("");

  const allItems = viewModel?.knowledgeItems ?? [];

  const filtered = allItems.filter((item) => {
    const matchesFilter =
      filter === "すべて" ||
      (filter === "有効" && item.status === "active") ||
      (filter === "無効" && item.status === "disabled");
    const matchesSearch =
      searchQuery === "" ||
      item.title.includes(searchQuery) ||
      item.summary.includes(searchQuery);
    return matchesFilter && matchesSearch;
  });

  function handleSearch(query: string) {
    setSearchQuery(query);
    send({ type: "searchKnowledge", query });
  }

  function handleFilter(f: "すべて" | "有効" | "無効") {
    setFilter(f);
    send({ type: "filterKnowledge", filter: f });
  }

  return (
    <>
      <BackHeader />
      <div className="page-title">ナレッジ管理</div>

      <div className="search-bar">
        <span className="material-symbols-outlined search-icon">search</span>
        <input
          type="text"
          placeholder="検索..."
          value={searchQuery}
          onChange={(e) => handleSearch(e.target.value)}
        />
      </div>

      <div className="filter-tabs">
        {(["すべて", "有効", "無効"] as const).map((f) => (
          <button
            key={f}
            className={filter === f ? "active" : ""}
            onClick={() => handleFilter(f)}
          >
            {f}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div className="empty-state">
          <span className="material-symbols-outlined empty-state-icon">auto_stories</span>
          <div className="empty-title">まだナレッジがありません</div>
          <div className="empty-desc">回答下の保存ボタンから追加できます</div>
        </div>
      ) : (
        <div id="knowledgeList">
          {filtered.map((item) => (
            <div key={item.id} className="card">
              <div className="knowledge-item-head">
                <span className="section-title">{item.title}</span>
                <Badge variant={item.status === "active" ? "green" : "gray"}>
                  {item.status === "active" ? "有効" : "無効"}
                </Badge>
              </div>
              <div className="muted">{item.summary}</div>
              <div className="muted knowledge-item-date">
                <span className="material-symbols-outlined">schedule</span>
                {item.updatedAt}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="bottom-actions">
        <button className="secondary" onClick={() => send({ type: "exportKnowledge" })}>
          <span className="material-symbols-outlined">download</span>
          エクスポート
        </button>
        <button className="danger" onClick={() => send({ type: "resetKnowledge" })}>
          <span className="material-symbols-outlined">delete_sweep</span>
          リセット
        </button>
      </div>
    </>
  );
}
