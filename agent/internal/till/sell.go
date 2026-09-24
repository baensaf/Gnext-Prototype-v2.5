package till

// catalog reads the snapshot the till sells from.
func (t *Till) catalog() (*Catalog, error) {
	raw, err := t.Snapshot()
	if err != nil {
		return nil, refuse(CodeNoSnapshot, "هنوز منوی شعبه از سرور دریافت نشده است.")
	}
	return ParseCatalog(raw)
}

// Menu is the branch's catalogue with what can be sold right now (§13.13 `menu`).
func (t *Till) Menu() (Menu, error) {
	t.init()
	c, err := t.catalog()
	if err != nil {
		return Menu{}, err
	}
	return c.Menu(t.Now(), t.Sold), nil
}

// Price checks and prices a set of lines as one order (§12.4, §13.6).
func (t *Till) Price(lines []LineInput) ([]Line, Totals, error) {
	t.init()
	c, err := t.catalog()
	if err != nil {
		return nil, Totals{}, err
	}
	return c.Price(t.Now(), lines, t.Sold)
}
