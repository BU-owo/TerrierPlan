import { BU_LINKS } from '../data/officialLinks';

function OfficialLink({ link, label = link.label }) {
  return (
    <a href={link.url} target="_blank" rel="noopener noreferrer">
      {label}
    </a>
  );
}

export default function Disclaimer() {
  return (
    <section id="disclaimer" className="home-disclaimer" aria-labelledby="home-disclaimer-title">
      <div className="home-disclaimer-inner">
        <h2 id="home-disclaimer-title" className="home-disclaimer-title">
          Unofficial. Not affiliated with Boston University.
        </h2>
        <p>
          TerrierPlan is built and maintained by BUowo and friends. It is not affiliated with,
          endorsed by, or reviewed by Boston University. TerrierPlan can be wrong or out of date. HUB
          and credit totals are estimates. Nothing here is official advice or an official record.
        </p>
        <h3 className="home-disclaimer-subtitle">Always confirm with official BU sources:</h3>
        <ul className="home-disclaimer-list">
          <li>Course schedule &amp; enrollment: <OfficialLink link={BU_LINKS.myBU} /></li>
          <li>Degree requirements: <OfficialLink link={BU_LINKS.bulletin} /></li>
          <li>HUB requirements: <OfficialLink link={BU_LINKS.hub} /></li>
          <li>Registrar: <OfficialLink link={BU_LINKS.registrar} label="policies and deadlines" /></li>
          <li>Your academic advisor, before you make any decision</li>
        </ul>
      </div>
    </section>
  );
}
