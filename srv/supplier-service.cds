using supplier from '../db/schema';

service SupplierService{
    entity Applications as projection on supplier.Applications;
}