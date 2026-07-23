import { useEffect, useState } from "react";

export default function ScrollToTopButton() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const onScroll = () => {
      setVisible(window.scrollY > 500);
    };

    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });

    return () => {
      window.removeEventListener("scroll", onScroll);
    };
  }, []);

  if (!visible) return null;

  return (
    <button
      className="review-scroll-top"
      type="button"
      aria-label="回到页面顶部"
      title="回到顶部"
      onClick={() => {
        window.scrollTo({
          top: 0,
          behavior: "smooth",
        });
      }}
    >
      ↑
    </button>
  );
}
